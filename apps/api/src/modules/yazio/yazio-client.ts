import { createLimiter } from '../../common/limit.util';
import { retry } from '../../common/retry.util';
import type {
  YazioBodyValue,
  YazioConsumedItems,
  YazioDailyNutrients,
  YazioDietaryPreferences,
  YazioExercises,
  YazioExerciseSummary,
  YazioFastingSession,
  YazioFeeling,
  YazioGoals,
  YazioProduct,
  YazioRecipe,
  YazioSettings,
  YazioStreak,
  YazioSubscription,
  YazioToken,
  YazioUser,
  YazioWater,
} from './yazio.types';

/** Виды замеров тела, которые имеет смысл спрашивать. Каждый — один запрос на период. */
export const BODY_VALUE_KINDS = [
  'weight',
  'body_fat',
  'muscle_ratio',
  'waist',
  'hip',
  'chest',
] as const;

export class YazioApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `${endpoint}: YAZIO ответил ${status}`);
    this.name = 'YazioApiError';
  }
}

export class YazioAuthError extends Error {
  /** Не наша поломка, а отказ на входе: контроллер отдаст 401, а не 500. */
  readonly httpStatus = 401;

  constructor(message = 'Учётные данные YAZIO не приняты') {
    super(message);
    this.name = 'YazioAuthError';
  }
}

export interface YazioTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface YazioClientOptions {
  email: string;
  /** Может отсутствовать: у аккаунта через Apple ID пароля нет (D-017). */
  password?: string;
  /**
   * Пара OAuth самого приложения YAZIO: одна на все установки, но в репозитории
   * её нет — приходит из окружения (D-086). Пара привязана к версии API: v9 и
   * v22 не взаимозаменяемы.
   */
  client?: { id: string; secret: string };
  base?: string;
  version?: string;
  timeoutMs?: number;
  concurrency?: number;
  tokens?: Partial<YazioTokens>;
  /** Зовётся после каждого обновления токенов — чтобы сохранить их в базу. */
  onTokens?: (tokens: YazioTokens) => void | Promise<void>;
  /** Подмена в тестах. */
  fetchImpl?: typeof fetch;
  /** Подмена паузы между повторами в тестах. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Клиент недокументированного API YAZIO.
 *
 * Один экземпляр обслуживает один аккаунт: держит его токены, сам их обновляет
 * и сам ограничивает параллельность. Выгрузка четырёхлетней истории — тысячи
 * запросов за минуты, поэтому и протухание токена посреди работы, и упор в 429
 * тут не экзотика, а норма.
 */
/** Годен ли токен к отправке: пустой и неASCII считаются отсутствующими. */
function usableToken(token: string | null | undefined): string | null {
  if (!token) return null;
  // eslint-disable-next-line no-control-regex
  return /^[\x21-\x7e]+$/.test(token) ? token : null;
}

export class YazioClient {
  private readonly base: string;
  private readonly version: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly limit: <T>(task: () => Promise<T>) => Promise<T>;

  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: Date | null;

  /** Одно обновление токена на всех: без этого шесть параллельных 401 дадут шесть логинов. */
  private authInFlight: Promise<void> | null = null;

  /** Счётчик запросов к YAZIO — попадает в отчёт о синхронизации. */
  requests = 0;

  constructor(private readonly options: YazioClientOptions) {
    this.base = (options.base ?? 'https://yzapi.yazio.com').replace(/\/+$/, '');
    this.version = (options.version ?? 'v9').replace(/^\/+|\/+$/g, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep;
    this.limit = createLimiter(options.concurrency ?? 6);

    // токен уезжает в заголовок, а заголовок обязан быть ASCII: испорченное
    // значение из базы иначе роняет выгрузку невнятной ошибкой кодировки
    this.accessToken = usableToken(options.tokens?.accessToken);
    this.refreshToken = usableToken(options.tokens?.refreshToken);
    this.expiresAt = options.tokens?.expiresAt ?? null;
  }

  get tokens(): YazioTokens {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
    };
  }

  private get credentials(): { id: string; secret: string } {
    const client = this.options.client;
    if (!client?.id || !client.secret) {
      throw new YazioAuthError('Не задана пара приложения YAZIO: YAZIO_CLIENT_ID и YAZIO_CLIENT_SECRET в .env');
    }
    return client;
  }

  // ── авторизация ────────────────────────────────────────────────────────────

  /** Вход по паролю. Публичный: им же проверяется аккаунт при добавлении. */
  async login(): Promise<void> {
    const password = this.options.password;
    if (!password) {
      throw new YazioAuthError(
        'Токен YAZIO больше не принимается, а пароля у аккаунта нет — нужен свежий токен',
      );
    }

    const { id, secret } = this.credentials;
    await this.exchange({
      client_id: id,
      client_secret: secret,
      username: this.options.email,
      password,
      grant_type: 'password',
    });
  }

  private async refreshTokens(): Promise<void> {
    if (!this.refreshToken) {
      await this.login();
      return;
    }
    const { id, secret } = this.credentials;
    try {
      await this.exchange({
        client_id: id,
        client_secret: secret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      });
    } catch (error) {
      // отозванный refresh — штатный конец жизни токена, а не сбой:
      // пароль сохранён именно для этого случая (D-004)
      if (error instanceof YazioAuthError) {
        this.refreshToken = null;
        await this.login();
        return;
      }
      throw error;
    }
  }

  private async exchange(body: Record<string, string>): Promise<void> {
    const response = await this.send('login', `/${this.version}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 400 || response.status === 401) {
      throw new YazioAuthError();
    }
    if (!response.ok) {
      throw new YazioApiError('login', response.status);
    }

    const token = (await response.json()) as YazioToken;
    this.accessToken = token.access_token;
    // YAZIO возвращает новый refresh не всегда — старый в таком случае остаётся рабочим
    this.refreshToken = token.refresh_token ?? this.refreshToken;
    this.expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;

    await this.options.onTokens?.(this.tokens);
  }

  /** Гарантирует живой токен перед запросом; параллельные вызовы ждут один вход. */
  private async ensureAuth(force = false): Promise<void> {
    const expiringSoon = this.expiresAt !== null && this.expiresAt.getTime() - Date.now() < 60_000;
    if (!force && this.accessToken && !expiringSoon) return;

    this.authInFlight ??= (async () => {
      try {
        if (this.accessToken || this.refreshToken) await this.refreshTokens();
        else await this.login();
      } finally {
        this.authInFlight = null;
      }
    })();

    await this.authInFlight;
  }

  // ── транспорт ──────────────────────────────────────────────────────────────

  private async send(endpoint: string, path: string, init: RequestInit): Promise<Response> {
    this.requests++;
    return this.fetchImpl(`${this.base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`${endpoint}: ${message}`), {
        code: (error as { code?: string }).code ?? 'FETCH_FAILED',
        cause: error,
      });
    });
  }

  private async get<T>(endpoint: string, path: string): Promise<T> {
    return this.limit(() =>
      retry(
        async () => {
          await this.ensureAuth();
          let response = await this.send(endpoint, path, {
            headers: { Authorization: `Bearer ${this.accessToken ?? ''}` },
          });

          if (response.status === 401) {
            // токен мог протухнуть посреди многочасовой выгрузки — обновляем и повторяем один раз
            await this.ensureAuth(true);
            response = await this.send(endpoint, path, {
              headers: { Authorization: `Bearer ${this.accessToken ?? ''}` },
            });
          }

          if (response.status === 401) throw new YazioAuthError();
          if (!response.ok) throw new YazioApiError(endpoint, response.status);

          return (await response.json()) as T;
        },
        { label: endpoint, sleep: this.sleep },
      ),
    );
  }

  /**
   * Как `get`, но 404 значит «ничего не записано», а не сбой. День без воды —
   * это не ошибка, и в предупреждения он попадать не должен.
   */
  private async getOptional<T>(endpoint: string, path: string): Promise<T | null> {
    try {
      return await this.get<T>(endpoint, path);
    } catch (error) {
      if (error instanceof YazioApiError && error.status === 404) return null;
      return this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    throw error;
  }

  // ── эндпоинты ──────────────────────────────────────────────────────────────

  user(): Promise<YazioUser> {
    return this.get('user', `/${this.version}/user`);
  }

  settings(): Promise<YazioSettings> {
    return this.get('settings', `/${this.version}/user/settings`);
  }

  dietaryPreferences(): Promise<YazioDietaryPreferences> {
    return this.get('dietary-preferences', `/${this.version}/user/dietary-preferences`);
  }

  subscriptions(): Promise<YazioSubscription[]> {
    return this.get('subscription', `/${this.version}/user/subscription`);
  }

  streak(): Promise<YazioStreak> {
    return this.get('streak', `/${this.version}/user/streak`);
  }

  fastingHistory(): Promise<YazioFastingSession[]> {
    return this.get('fasting-history', `/${this.version}/user/fasting-countdowns/history`);
  }

  /** Один запрос на весь период. На нём держится инкрементальность (D-012). */
  dailyNutrients(from: string, to: string): Promise<YazioDailyNutrients[]> {
    return this.get(
      'nutrients-daily',
      `/${this.version}/user/consumed-items/nutrients-daily?start=${from}&end=${to}`,
    );
  }

  exerciseSummary(from: string, to: string): Promise<YazioExerciseSummary[]> {
    return this.get(
      'exercises-summary',
      `/${this.version}/user/exercises/summary-daily?start=${from}&end=${to}`,
    );
  }

  /**
   * Диапазонная форма замеров тела. В опубликованном описании её нет — там
   * только `weight/last?date=`, — но отвечает она для всех видов и остаётся
   * единственным доступным способом выгрузить многолетнюю историю.
   */
  bodyValues(kind: string, from: string, to: string): Promise<YazioBodyValue[]> {
    return this.get(
      'body-values',
      `/${this.version}/user/bodyvalues/${kind}?start=${from}&end=${to}`,
    );
  }

  consumed(date: string): Promise<YazioConsumedItems> {
    return this.get('consumed-items', `/${this.version}/user/consumed-items?date=${date}`);
  }

  exercises(date: string): Promise<YazioExercises> {
    return this.get('exercises', `/${this.version}/user/exercises?date=${date}`);
  }

  async water(date: string): Promise<YazioWater> {
    return (
      (await this.getOptional<YazioWater>(
        'water-intake',
        `/${this.version}/user/water-intake?date=${date}`,
      )) ?? {}
    );
  }

  async goals(date: string): Promise<YazioGoals> {
    return (
      (await this.getOptional<YazioGoals>('goals', `/${this.version}/user/goals?date=${date}`)) ?? {}
    );
  }

  async goalsUnmodified(date: string): Promise<YazioGoals> {
    return (
      (await this.getOptional<YazioGoals>(
        'goals-unmodified',
        `/${this.version}/user/goals/unmodified?date=${date}`,
      )) ?? {}
    );
  }

  async feeling(date: string): Promise<YazioFeeling> {
    return (
      (await this.getOptional<YazioFeeling>('feeling', `/${this.version}/user/feeling?date=${date}`)) ??
      {}
    );
  }

  product(id: string): Promise<YazioProduct> {
    return this.get('product', `/${this.version}/products/${id}`);
  }

  /**
   * Публичные рецепты и собственные лежат по разным путям, а запись дневника не
   * говорит, какой это. Сначала спрашиваем публичный, на 404 — пользовательский.
   */
  async recipe(id: string): Promise<{ recipe: YazioRecipe; isUserRecipe: boolean }> {
    const shared = await this.getOptional<YazioRecipe>('recipe', `/${this.version}/recipes/${id}`);
    if (shared) return { recipe: shared, isUserRecipe: false };

    const own = await this.get<YazioRecipe>('user-recipe', `/${this.version}/user/recipes/${id}`);
    return { recipe: own, isUserRecipe: true };
  }
}
