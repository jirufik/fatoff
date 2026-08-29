import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  YazioBodyValue,
  YazioConsumedItems,
  YazioDailyNutrients,
  YazioExercises,
  YazioExerciseSummary,
  YazioFeeling,
  YazioGoals,
  YazioProduct,
  YazioRecipe,
  YazioUser,
  YazioWater,
} from '../src/modules/yazio/yazio.types';

export interface FakeDay {
  consumed?: YazioConsumedItems;
  exercises?: YazioExercises;
  water?: YazioWater;
  goals?: YazioGoals;
  goalsUnmodified?: YazioGoals;
  feeling?: YazioFeeling;
}

export interface FakeAccountData {
  email: string;
  password: string;
  user: YazioUser;
  settings: Record<string, unknown>;
  dietaryPreferences: Record<string, unknown>;
  subscriptions: unknown[];
  streak: Record<string, { daytimes: string[]; origin_of_recovery: string | null }>;
  fasting: unknown[];
  dailyNutrients: YazioDailyNutrients[];
  exerciseSummary: YazioExerciseSummary[];
  bodyValues: Record<string, YazioBodyValue[]>;
  days: Record<string, FakeDay>;
  products: Record<string, YazioProduct>;
  recipes: Record<string, YazioRecipe>;
  userRecipes: Record<string, YazioRecipe>;
}

/** Заготовленный сбой: сработает `times` раз на путях, попадающих под `match`. */
export interface FakeFailure {
  match: string | RegExp;
  status: number;
  times: number;
}

/**
 * Подставной YAZIO.
 *
 * Нужен затем, что счастливый путь проверить легко, а всё интересное — 401
 * посреди выгрузки, 429, обрыв, 404 на дне без воды — на живом API не
 * воспроизвести по заказу.
 */
export class FakeYazio {
  private server: Server | null = null;
  private readonly failures: FakeFailure[] = [];

  /** Журнал путей: по нему проверяется, что повторный синк ничего лишнего не спросил. */
  readonly requests: string[] = [];

  accessToken = 'access-1';
  refreshToken = 'refresh-1';
  /** Сколько раз принимать refresh_token до того, как начать его отвергать. */
  refreshAccepted = Number.POSITIVE_INFINITY;
  tokenExpiresIn = 172_800;

  constructor(private readonly data: FakeAccountData) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req.method ?? 'GET', req.url ?? '/', req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  failNext(match: string | RegExp, status: number, times = 1): void {
    this.failures.push({ match, status, times });
  }

  /** Сколько раз спрашивали пути, содержащие подстроку. */
  countOf(fragment: string): number {
    return this.requests.filter((path) => path.includes(fragment)).length;
  }

  reset(): void {
    this.requests.length = 0;
    this.failures.length = 0;
  }

  private takeFailure(path: string): number | null {
    const failure = this.failures.find((f) =>
      typeof f.match === 'string' ? path.includes(f.match) : f.match.test(path),
    );
    if (!failure || failure.times <= 0) return null;
    failure.times--;
    return failure.status;
  }

  private async handle(
    method: string,
    url: string,
    req: NodeJS.ReadableStream,
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string) => void },
  ): Promise<void> {
    this.requests.push(url);

    const send = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body ?? null));
    };

    const failure = this.takeFailure(url);
    if (failure !== null) return send(failure, { error: 'подстроенный сбой' });

    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    const parts = path.split('/').filter(Boolean).slice(1); // отбрасываем версию

    if (method === 'POST' && path.endsWith('/oauth/token')) {
      const body = JSON.parse(await readBody(req)) as Record<string, string>;
      if (body.grant_type === 'refresh_token') {
        if (body.refresh_token !== this.refreshToken || this.refreshAccepted <= 0) {
          return send(400, { error: 'invalid_grant' });
        }
        this.refreshAccepted--;
      } else if (body.username !== this.data.email || body.password !== this.data.password) {
        return send(400, { error: 'invalid_grant' });
      }
      return send(200, {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        expires_in: this.tokenExpiresIn,
        token_type: 'bearer',
      });
    }

    const auth = (req as unknown as { headers: Record<string, string> }).headers?.authorization;
    if (auth !== `Bearer ${this.accessToken}`) return send(401, { error: 'unauthorized' });

    const date = params.get('date') ?? '';
    const start = params.get('start') ?? '0000-00-00';
    const end = params.get('end') ?? '9999-99-99';
    const inRange = (value: string): boolean => {
      const day = value.slice(0, 10);
      return day >= start && day <= end;
    };

    const route = parts.join('/');

    if (route === 'user') return send(200, this.data.user);
    if (route === 'user/settings') return send(200, this.data.settings);
    if (route === 'user/dietary-preferences') return send(200, this.data.dietaryPreferences);
    if (route === 'user/subscription') return send(200, this.data.subscriptions);
    if (route === 'user/streak') return send(200, this.data.streak);
    if (route === 'user/fasting-countdowns/history') return send(200, this.data.fasting);

    if (route === 'user/consumed-items/nutrients-daily') {
      return send(200, this.data.dailyNutrients.filter((d) => inRange(d.date)));
    }
    if (route === 'user/exercises/summary-daily') {
      return send(200, this.data.exerciseSummary.filter((d) => inRange(d.date)));
    }
    if (parts[0] === 'user' && parts[1] === 'bodyvalues') {
      const kind = parts[2] ?? '';
      return send(200, (this.data.bodyValues[kind] ?? []).filter((v) => inRange(v.date)));
    }

    if (route === 'user/consumed-items') {
      return send(200, this.data.days[date]?.consumed ?? { products: [], recipe_portions: [], simple_products: [] });
    }
    if (route === 'user/exercises') {
      return send(200, this.data.days[date]?.exercises ?? { training: [], custom_training: [] });
    }
    if (route === 'user/water-intake') {
      const water = this.data.days[date]?.water;
      return water ? send(200, water) : send(404, { error: 'нет записи' });
    }
    if (route === 'user/goals') {
      const goals = this.data.days[date]?.goals;
      return goals ? send(200, goals) : send(404, { error: 'нет записи' });
    }
    if (route === 'user/goals/unmodified') {
      const goals = this.data.days[date]?.goalsUnmodified ?? this.data.days[date]?.goals;
      return goals ? send(200, goals) : send(404, { error: 'нет записи' });
    }
    if (route === 'user/feeling') {
      const feeling = this.data.days[date]?.feeling;
      return feeling ? send(200, feeling) : send(404, { error: 'нет записи' });
    }

    if (parts[0] === 'products') {
      const product = this.data.products[parts[1] ?? ''];
      return product ? send(200, product) : send(404, { error: 'нет продукта' });
    }
    if (parts[0] === 'recipes') {
      const recipe = this.data.recipes[parts[1] ?? ''];
      return recipe ? send(200, recipe) : send(404, { error: 'нет рецепта' });
    }
    if (route.startsWith('user/recipes/')) {
      const recipe = this.data.userRecipes[parts[2] ?? ''];
      return recipe ? send(200, recipe) : send(404, { error: 'нет рецепта' });
    }

    return send(404, { error: `неизвестный путь ${path}` });
  }
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

/** Ответы `YazioProduct` типизированы шире, чем нужно фикстурам. */
export type { YazioProduct, YazioRecipe, YazioUser };
