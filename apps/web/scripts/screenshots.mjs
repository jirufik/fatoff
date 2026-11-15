#!/usr/bin/env node
/**
 * Снимки интерфейса для README — на демо-аккаунте и только на нём (D-086).
 *
 * Живые данные в снимок попасть не должны, а база разработки — копия рабочей.
 * Поэтому снимать надо с контура на пустой базе, где кроме демо нет ничего:
 *
 *   docker exec fatoff-develop-postgresql psql -U fatoff -d postgres -c 'create database fatoff_shots'
 *   pnpm --filter @fatoff/web build
 *   cd apps/api && DB_NAME=fatoff_shots SCHEDULES_ENABLED=false node dist/main
 *   BASE=http://localhost:4290 PASSWORD=… pnpm --filter @fatoff/web run screenshots
 *
 * Не через `pnpm run dev`: turbo в строгом режиме не пропускает необъявленные
 * переменные, `DB_NAME` теряется, и сервис уходит в базу разработки — копию
 * рабочей. Собранная версия заодно избавляет кадр от панели инструментов Nuxt.
 *
 * Скрипт сам отказывается работать, если в базе есть хоть один аккаунт, кроме демо.
 * Демо пересобирается на языке снимка: названия блюд и планов в нём двуязычные.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4291';
const PASSWORD = process.env.PASSWORD;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots');

if (!PASSWORD) {
  console.error('Задайте PASSWORD — пароль входа в сервис (APP_PASSWORD из .env).');
  process.exit(2);
}

const GENERATE = { ru: 'Сгенерировать', en: 'Generate' };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function session(locale, { width = 1440, height = 900, theme = 'dark', mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 3 : 1.5,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`, { timeout: 10_000 });
  await page.evaluate(
    ([lang, mode]) => {
      localStorage.setItem('fatoff:locale', lang);
      localStorage.setItem('fatoff:theme', mode);
      localStorage.setItem('fatoff:palette', 'tokyo');
    },
    [locale, theme],
  );
  return { context, page };
}

/** Демо на нужном языке; любой другой аккаунт в базе — повод остановиться. */
async function demoFor(page, locale) {
  const accounts = await page.evaluate(async () => (await fetch('/api/accounts', { credentials: 'include' })).json());
  const list = Array.isArray(accounts) ? accounts : (accounts.items ?? []);
  const foreign = list.filter((account) => !String(account.email ?? '').endsWith('.invalid'));
  if (foreign.length > 0) {
    throw new Error(`в базе ${foreign.length} настоящих аккаунтов — снимать можно только с пустой базы`);
  }
  const demo = await page.evaluate(async (lang) => {
    const response = await fetch('/api/demo', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: lang }),
    });
    return response.ok ? response.json() : null;
  }, locale);
  if (!demo?.id) throw new Error('демо не собралось');
  return demo.id;
}

const settle = (page, ms = 800) => page.waitForTimeout(ms);

async function shoot(page, name, { full = false } = {}) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log('снимок:', file);
}

for (const locale of ['en', 'ru']) {
  const { context, page } = await session(locale);
  const id = await demoFor(page, locale);
  const acc = `${BASE}/accounts/${id}`;

  await page.goto(acc);
  await page.waitForSelector('.card', { timeout: 15_000 });
  await settle(page, 1200);
  await shoot(page, `${locale}-home`);

  await page.goto(`${acc}/journal`);
  await page.waitForSelector('.day', { timeout: 15_000 });
  await settle(page);
  await page.locator('.day').nth(1).locator('.day__head').first().click();
  await settle(page);
  await page.locator('.day').nth(1).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await settle(page, 300);
  await shoot(page, `${locale}-day`);

  await page.goto(`${acc}/planner`);
  await page.waitForSelector('.modes', { timeout: 15_000 });
  await settle(page);
  await shoot(page, `${locale}-planner`);
  await page.locator(`button:has-text("${GENERATE[locale]}")`).first().click();
  await page.waitForSelector('.plan-day', { timeout: 30_000 });
  await settle(page);
  await page.locator('.plan-day').first().locator('.day__head').first().click();
  await settle(page);
  await page.locator('.plan-day').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await settle(page, 300);
  await shoot(page, `${locale}-plan`);

  await page.goto(`${acc}/guide`);
  await page.waitForSelector('svg', { timeout: 15_000 });
  await settle(page);
  await shoot(page, `${locale}-guide`);

  await page.goto(`${acc}/data`);
  await settle(page, 1500);
  await shoot(page, `${locale}-data`);
  await context.close();

  // телефон — одним кадром, чтобы было видно, что раскладка под него есть
  const phone = await session(locale, { width: 360, height: 780, mobile: true });
  await phone.page.goto(acc);
  await phone.page.waitForSelector('.card', { timeout: 15_000 });
  await settle(phone.page, 1200);
  await shoot(phone.page, `${locale}-home-phone`);
  await phone.context.close();
}

await browser.close();
