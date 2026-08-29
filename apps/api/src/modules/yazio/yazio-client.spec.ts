import { describe, expect, it, vi } from 'vitest';

import { YazioAuthError, YazioClient } from './yazio-client';

interface Call {
  url: string;
  init: RequestInit;
}

/** Ответ-заглушка: fetch отдаёт объект, достаточный для клиента. */
const reply = (status: number, body: unknown = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const TOKEN = { access_token: 'a1', refresh_token: 'r1', expires_in: 172_800 };

/** Фейковый fetch: очередь ответов по маске пути плюс журнал вызовов. */
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const clientWith = (
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  overrides: Partial<ConstructorParameters<typeof YazioClient>[0]> = {},
) => {
  const { impl, calls } = fakeFetch(handler);
  const client = new YazioClient({
    email: 'user@example.com',
    password: 'secret',
    fetchImpl: impl,
    sleep: async () => undefined,
    ...overrides,
  });
  return { client, calls, impl };
};

describe('YazioClient — авторизация', () => {
  it('входит по паролю и запоминает токены', async () => {
    const saved: unknown[] = [];
    const { client, calls } = clientWith(
      (url) => (url.includes('/oauth/token') ? reply(200, TOKEN) : reply(200, { registration_date: '2020-01-01' })),
      { onTokens: (t) => void saved.push(t) },
    );

    await client.user();

    const login = calls.find((c) => c.url.includes('/oauth/token'));
    expect(login).toBeDefined();
    const body = JSON.parse(String(login!.init.body)) as Record<string, string>;
    expect(body.grant_type).toBe('password');
    expect(body.username).toBe('user@example.com');
    expect(body.client_id).toMatch(/^1_/); // пара v9
    expect(client.tokens.accessToken).toBe('a1');
    expect(saved).toHaveLength(1);
  });

  it('подставляет пару client_id для v22, а не для v9', async () => {
    const { client, calls } = clientWith(() => reply(200, TOKEN), { version: 'v22' });
    await client.login();
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, string>;
    expect(body.client_id).toMatch(/^3_/);
  });

  it('превращает 400 на входе в понятную ошибку', async () => {
    const { client } = clientWith(() => reply(400, { error: 'invalid_grant' }));
    await expect(client.login()).rejects.toBeInstanceOf(YazioAuthError);
  });

  it('прикладывает Bearer к каждому запросу', async () => {
    const { client, calls } = clientWith((url) =>
      url.includes('/oauth/token') ? reply(200, TOKEN) : reply(200, {}),
    );
    await client.settings();
    const request = calls.at(-1)!;
    expect((request.init.headers as Record<string, string>).Authorization).toBe('Bearer a1');
  });

  it('обновляет токен при 401 и повторяет запрос', async () => {
    let unauthorized = true;
    const { client, calls } = clientWith((url) => {
      if (url.includes('/oauth/token')) return reply(200, { ...TOKEN, access_token: 'a2' });
      if (unauthorized) {
        unauthorized = false;
        return reply(401);
      }
      return reply(200, { ok: true });
    }, { tokens: { accessToken: 'stale', refreshToken: 'r0' } });

    await expect(client.settings()).resolves.toEqual({ ok: true });

    const refresh = calls.find((c) => c.url.includes('/oauth/token'))!;
    expect(JSON.parse(String(refresh.init.body)).grant_type).toBe('refresh_token');
    expect((calls.at(-1)!.init.headers as Record<string, string>).Authorization).toBe('Bearer a2');
  });

  it('логинится заново, когда refresh отозван', async () => {
    const grants: string[] = [];
    const { client } = clientWith((url, init) => {
      if (url.includes('/oauth/token')) {
        const grant = JSON.parse(String(init.body)).grant_type as string;
        grants.push(grant);
        return grant === 'refresh_token' ? reply(400) : reply(200, TOKEN);
      }
      return reply(200, {});
    }, { tokens: { accessToken: null, refreshToken: 'revoked-refresh' } });

    await client.settings();
    expect(grants).toEqual(['refresh_token', 'password']);
  });

  it('на шесть параллельных 401 делает один вход', async () => {
    let logins = 0;
    let refreshed = false;
    const { client } = clientWith((url) => {
      if (url.includes('/oauth/token')) {
        logins++;
        refreshed = true;
        return reply(200, TOKEN);
      }
      return refreshed ? reply(200, {}) : reply(401);
    }, { tokens: { accessToken: 'stale', refreshToken: 'r0' }, concurrency: 6 });

    await Promise.all(Array.from({ length: 6 }, () => client.settings()));
    expect(logins).toBe(1);
  });

  it('без пароля не пытается войти заново, а говорит, что нужен свежий токен', async () => {
    // так выглядит аккаунт, заведённый через Apple ID: пароля не существует
    const { impl } = fakeFetch((url) => (url.includes('/oauth/token') ? reply(400) : reply(401)));
    const client = new YazioClient({
      email: 'user@example.com',
      fetchImpl: impl,
      sleep: async () => undefined,
      tokens: { accessToken: 'stale', refreshToken: 'revoked' },
    });

    await expect(client.settings()).rejects.toThrow(/нужен свежий токен/);
  });

  it('обновляет токен заранее, если он вот-вот истечёт', async () => {
    const grants: string[] = [];
    const { client } = clientWith((url, init) => {
      if (url.includes('/oauth/token')) {
        grants.push(JSON.parse(String(init.body)).grant_type as string);
        return reply(200, TOKEN);
      }
      return reply(200, {});
    }, {
      tokens: { accessToken: 'почти истёк', refreshToken: 'r0', expiresAt: new Date(Date.now() + 5_000) },
    });

    await client.settings();
    expect(grants).toEqual(['refresh_token']);
  });
});

describe('YazioClient — запросы', () => {
  const authorized =
    (handler: (url: string) => Response) =>
    (url: string): Response =>
      url.includes('/oauth/token') ? reply(200, TOKEN) : handler(url);

  it('404 на дневном эндпоинте значит «не записано», а не сбой', async () => {
    const { client } = clientWith(authorized(() => reply(404)));
    await expect(client.water('2026-08-28')).resolves.toEqual({});
    await expect(client.goals('2026-08-28')).resolves.toEqual({});
    await expect(client.feeling('2026-08-28')).resolves.toEqual({});
  });

  it('404 на публичном рецепте уводит к пользовательскому', async () => {
    const { client, calls } = clientWith(
      authorized((url) => (url.includes('/user/recipes/') ? reply(200, { name: 'Мой суп' }) : reply(404))),
    );

    await expect(client.recipe('r-1')).resolves.toEqual({
      recipe: { name: 'Мой суп' },
      isUserRecipe: true,
    });
    expect(calls.some((c) => c.url.endsWith('/v9/recipes/r-1'))).toBe(true);
  });

  it('повторяет 429 и добивается ответа', async () => {
    let attempt = 0;
    const { client } = clientWith(
      authorized(() => (++attempt < 3 ? reply(429) : reply(200, { ok: true }))),
    );
    await expect(client.settings()).resolves.toEqual({ ok: true });
    expect(attempt).toBe(3);
  });

  it('не повторяет 404 на обязательном эндпоинте — это не временный сбой', async () => {
    let attempt = 0;
    const { client } = clientWith(authorized(() => { attempt++; return reply(404); }));
    await expect(client.product('p-1')).rejects.toThrow(/404/);
    expect(attempt).toBe(1);
  });

  it('держит лимит параллельности', async () => {
    let active = 0;
    let peak = 0;
    const { impl } = fakeFetch(async (url) => {
      if (url.includes('/oauth/token')) return reply(200, TOKEN);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return reply(200, {});
    });
    const client = new YazioClient({
      email: 'u',
      password: 'p',
      fetchImpl: impl,
      concurrency: 2,
      tokens: { accessToken: 'a1' },
    });

    await Promise.all(Array.from({ length: 10 }, (_, i) => client.consumed(`2026-08-0${i}`)));
    expect(peak).toBe(2);
  });

  it('считает запросы — счётчик уходит в отчёт о синхронизации', async () => {
    const { client } = clientWith(authorized(() => reply(200, {})));
    await client.settings();
    await client.streak();
    expect(client.requests).toBe(3); // вход плюс два запроса
  });

  it('складывает диапазонные пути по датам', async () => {
    const { client, calls } = clientWith(authorized(() => reply(200, [])));
    await client.dailyNutrients('2026-01-01', '2026-12-31');
    await client.bodyValues('weight', '2026-01-01', '2026-12-31');
    expect(calls.at(-2)!.url).toContain(
      '/v9/user/consumed-items/nutrients-daily?start=2026-01-01&end=2026-12-31',
    );
    expect(calls.at(-1)!.url).toContain('/v9/user/bodyvalues/weight?start=2026-01-01&end=2026-12-31');
  });
});
