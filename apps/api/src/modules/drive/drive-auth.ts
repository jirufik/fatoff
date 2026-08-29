import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Доступ к Drive: сервисный аккаунт или ключ API.
 *
 * Способа два, и они не равны. Ключ API открывает только то, что и так открыто
 * по ссылке: чтобы им пользоваться, папку приходится держать публичной.
 * Сервисный аккаунт — это отдельный пользователь Google со своей почтой; папку
 * можно открыть **ему одному**, и она останется закрытой для остального мира.
 * Для истории здоровья это существенная разница, поэтому сервисный аккаунт
 * предпочтительнее, а ключ остаётся запасным путём.
 *
 * Подпись делается вручную вместо библиотеки `googleapis`: там сорок строк
 * кода против полусотни мегабайт зависимостей, из которых нужен один запрос.
 */

/** Права: только чтение, только Drive. Больше сервису не нужно. */
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Токен живёт час; берём с запасом, чтобы не попасть на границу. */
const EARLY_REFRESH_SEC = 60;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface DriveAuth {
  /** Как называть способ в журнале и в интерфейсе. */
  kind: 'service-account' | 'api-key';
  /** Заголовки к запросу — у ключа пустые. */
  headers(): Promise<Record<string, string>>;
  /** Параметры строки запроса — у сервисного аккаунта пустые. */
  params(): Record<string, string>;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Собрать и подписать JWT для обмена на токен доступа.
 *
 * Вынесено отдельно и экспортировано ради тестов: проверить состав утверждений
 * можно без сети, а без такой проверки ошибка в области прав всплыла бы только
 * в виде 403 от Google.
 */
export function buildAssertion(account: ServiceAccount, now: number): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const payload = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(payload).sign(account.private_key);
  return `${payload}.${base64url(signature)}`;
}

class ServiceAccountAuth implements DriveAuth {
  readonly kind = 'service-account' as const;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly account: ServiceAccount) {}

  async headers(): Promise<Record<string, string>> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt - EARLY_REFRESH_SEC > now) {
      return { authorization: `Bearer ${this.token.value}` };
    }

    const response = await fetch(this.account.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildAssertion(this.account, now),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Google не выдал токен сервисному аккаунту: ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Google вернул ответ без токена');

    this.token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
    return { authorization: `Bearer ${this.token.value}` };
  }

  params(): Record<string, string> {
    return {};
  }
}

class ApiKeyAuth implements DriveAuth {
  readonly kind = 'api-key' as const;

  constructor(private readonly key: string) {}

  async headers(): Promise<Record<string, string>> {
    return {};
  }

  params(): Record<string, string> {
    return { key: this.key };
  }
}

/**
 * Чем открывать папку.
 *
 * Сервисный аккаунт выигрывает у ключа, если задан: он умеет то же и сверх того
 * позволяет не держать папку публичной. Нет ни того, ни другого — `null`, и
 * модуль честно скажет, что не настроен.
 */
export async function resolveDriveAuth(
  serviceAccountFile: string,
  apiKey: string,
): Promise<DriveAuth | null> {
  const path = serviceAccountFile.trim();
  if (path) {
    const raw = await readFile(path, 'utf8').catch(() => null);
    if (raw) {
      const account = JSON.parse(raw) as ServiceAccount;
      if (account.client_email && account.private_key) return new ServiceAccountAuth(account);
    }
  }

  const key = apiKey.trim();
  return key ? new ApiKeyAuth(key) : null;
}
