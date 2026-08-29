#!/usr/bin/env node
/**
 * Проверка живого API YAZIO: отвечают ли ещё эндпоинты, на которых стоит
 * выгрузка. Не тест — в CI ему делать нечего, он ходит в сеть и требует
 * настоящих учётных данных.
 *
 *   YAZIO_EMAIL=... YAZIO_PASSWORD=... pnpm --filter @fatoff/api run check:yazio
 */
import process from 'node:process';

const BASE = process.env.YAZIO_API_BASE ?? 'https://yzapi.yazio.com';
const VERSION = process.env.YAZIO_API_VERSION ?? 'v9';

const CLIENTS = {
  v9: {
    id: '<YAZIO_CLIENT_ID_V9>',
    // scan-secrets: allow — пара самого приложения YAZIO: одна на все
    // установки и извлекаемая из клиента, а не чей-то личный ключ
    secret: '<YAZIO_CLIENT_SECRET_V9>',
  },
  default: {
    id: '<YAZIO_CLIENT_ID_V22>',
    // scan-secrets: allow — пара самого приложения YAZIO: одна на все
    // установки и извлекаемая из клиента, а не чей-то личный ключ
    secret: '<YAZIO_CLIENT_SECRET_V22>',
  },
};

const email = process.env.YAZIO_EMAIL ?? process.argv[2];
const password = process.env.YAZIO_PASSWORD ?? process.argv[3];

if (!email || !password) {
  console.error('Нужны учётные данные: YAZIO_EMAIL и YAZIO_PASSWORD (или два аргумента).');
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

const client = CLIENTS[VERSION] ?? CLIENTS.default;

const login = await fetch(`${BASE}/${VERSION}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_id: client.id,
    client_secret: client.secret,
    username: email,
    password,
    grant_type: 'password',
  }),
});

if (!login.ok) {
  console.error(`Вход не удался: HTTP ${login.status}`);
  process.exit(1);
}

const { access_token: token } = await login.json();
console.log(`вход                                    OK`);

const paths = [
  'user',
  'user/settings',
  'user/dietary-preferences',
  'user/subscription',
  'user/streak',
  'user/fasting-countdowns/history',
  `user/consumed-items/nutrients-daily?start=${monthAgo}&end=${today}`,
  `user/exercises/summary-daily?start=${monthAgo}&end=${today}`,
  `user/bodyvalues/weight?start=${monthAgo}&end=${today}`,
  `user/bodyvalues/body_fat?start=${monthAgo}&end=${today}`,
  `user/consumed-items?date=${today}`,
  `user/exercises?date=${today}`,
  `user/water-intake?date=${today}`,
  `user/goals?date=${today}`,
  `user/goals/unmodified?date=${today}`,
  `user/feeling?date=${today}`,
];

let failed = 0;
for (const path of paths) {
  const response = await fetch(`${BASE}/${VERSION}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404 на дневных эндпоинтах — это «не записано», а не поломка
  const ok = response.ok || response.status === 404;
  if (!ok) failed++;
  const size = ok ? (await response.text()).length : 0;
  console.log(
    `${path.slice(0, 38).padEnd(38)}  ${ok ? 'OK ' : 'СБОЙ'} ${String(response.status).padStart(3)}  ${size ? `${size} б` : ''}`,
  );
}

console.log(failed === 0 ? '\nвсе эндпоинты отвечают' : `\nне ответили: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
