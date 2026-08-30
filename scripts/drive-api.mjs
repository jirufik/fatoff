#!/usr/bin/env node
/**
 * Доступ к Google Drive сервисным аккаунтом — общая часть.
 *
 * Тот же приём, что в модуле `drive` у сервиса (D-060): JWT подписывается
 * вручную, без библиотеки `googleapis` — там полсотни мегабайт зависимостей
 * ради нескольких запросов.
 *
 * Важное ограничение, купленное экспериментом: **у сервисного аккаунта квота
 * Drive равна нулю**. Он не может владеть файлами вовсе — попытка создать файл
 * с содержимым возвращает 403 `storageQuotaExceeded`. Зато он свободно создаёт
 * папки (они ничего не весят) и правит файлы, которыми владеет человек.
 * Отсюда всё устройство доски задач: структура — папками, содержимое — в
 * документе, созданном человеком (D-070).
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEY = process.env.GOOGLE_SERVICE_ACCOUNT_FILE
  ? resolve(process.env.GOOGLE_SERVICE_ACCOUNT_FILE)
  : resolve(new URL('..', import.meta.url).pathname, 'secrets/service-account.json');

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached = null;

/** Токен доступа. Живёт час, поэтому в пределах запуска берётся один раз. */
export async function accessToken(scope = 'https://www.googleapis.com/auth/drive') {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.scope === scope && cached.expiresAt - 60 > now) return cached.value;

  const account = JSON.parse(readFileSync(KEY, 'utf8'));
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope,
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const payload = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const jwt = `${payload}.${base64url(createSign('RSA-SHA256').update(payload).sign(account.private_key))}`;

  const response = await fetch(claims.aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google не выдал токен: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.json();
  cached = { scope, value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return cached.value;
}

/** Запрос к Drive. Ошибку показываем целиком: она обычно и есть ответ на вопрос. */
export async function drive(path, options = {}) {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Drive ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

/** Содержимое документа Google Docs простым текстом. */
export async function readDoc(id) {
  const token = await accessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Не удалось прочитать ${id}: ${response.status}`);
  return response.text();
}

/**
 * Заменить содержимое существующего документа.
 *
 * Именно заменить: создать свой мы не можем, а вот переписать чужой, открытый
 * нам на запись, — можем. Текст уходит как `text/plain` и конвертируется Google
 * обратно в документ.
 */
export async function writeDoc(id, text) {
  const token = await accessToken();
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,name,modifiedTime`,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain; charset=UTF-8' },
      body: text,
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Не удалось записать ${id}: ${response.status} ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

/** Папки ничего не весят, поэтому их сервисный аккаунт создавать может. */
export async function ensureFolder(name, parent) {
  const query = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and ` +
      `mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const found = await drive(`files?q=${query}&fields=files(id,name)`);
  if (found.files.length > 0) return found.files[0];

  return drive('files?fields=id,name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  });
}

/** Содержимое папки. */
export async function listFolder(parent) {
  const query = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  const { files } = await drive(
    `files?q=${query}&fields=files(id,name,mimeType,modifiedTime,owners(emailAddress))&orderBy=name&pageSize=200`,
  );
  return files;
}

/** Переименование — им же ставится статус задачи в имени папки. */
export const rename = (id, name) =>
  drive(`files/${id}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
