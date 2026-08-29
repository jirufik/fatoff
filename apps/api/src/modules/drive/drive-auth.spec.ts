import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildAssertion, resolveDriveAuth } from './drive-auth';

/**
 * Как сервис представляется Google.
 *
 * Ошибка в области прав или в составе утверждений всплыла бы только как 403 от
 * Google — без объяснения, что именно не так. Здесь она видна сразу.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const ACCOUNT = {
  // scan-secrets: allow — выдуманный адрес выдуманного аккаунта, ключ к нему
  // сгенерирован тут же и живёт только внутри этого прогона
  client_email: 'fatoff@example-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
};

const decode = (part: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fatoff-auth-'));
});

describe('доступ к Google Drive', () => {
  it('подписывает утверждение так, что подпись сходится', () => {
    const assertion = buildAssertion(ACCOUNT, 1_800_000_000);
    const [header, claims, signature] = assertion.split('.');

    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

    expect(verified).toBe(true);
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('просит только чтение Drive и ничего больше', () => {
    const claims = decode(buildAssertion(ACCOUNT, 1_800_000_000).split('.')[1]);

    expect(claims).toEqual({
      iss: ACCOUNT.client_email,
      // именно readonly: писать в чужую папку сервису незачем
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
  });

  it('сервисный аккаунт предпочитается ключу', async () => {
    const path = join(dir, 'service-account.json');
    await writeFile(path, JSON.stringify(ACCOUNT));

    const auth = await resolveDriveAuth(path, 'ключ-тоже-есть');
    expect(auth?.kind).toBe('service-account');
    // ключ в строку запроса при этом не попадает
    expect(auth?.params()).toEqual({});
  });

  it('без файла аккаунта берётся ключ', async () => {
    const auth = await resolveDriveAuth(join(dir, 'нет-такого.json'), 'ключ-апи');

    expect(auth?.kind).toBe('api-key');
    expect(auth?.params()).toEqual({ key: 'ключ-апи' });
    expect(await auth?.headers()).toEqual({});
  });

  it('битый файл аккаунта не выдаётся за рабочий', async () => {
    const path = join(dir, 'битый.json');
    await writeFile(path, JSON.stringify({ client_email: 'есть', private_key: '' }));

    expect((await resolveDriveAuth(path, 'запасной-ключ'))?.kind).toBe('api-key');
    expect(await resolveDriveAuth(path, '')).toBeNull();
  });

  it('без обоих способов честно отвечает «нечем»', async () => {
    expect(await resolveDriveAuth('', '')).toBeNull();
  });
});
