import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import {
  Account,
  HealthDaily,
  HealthImport,
  HealthPoint,
  HealthSleep,
  HealthWorkout,
} from '../../src/database/entities';
import { AppleHealthService } from '../../src/modules/apple-health/apple-health.service';
import { createTestOrm, testConfig } from '../orm-test';

const FIXTURES = resolve(__dirname, '../fixtures');

describe('загрузка выгрузки Apple Health', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let health: AppleHealthService;
  let account: Account;

  beforeAll(async () => {
    orm = await createTestOrm('apple_health');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();

    const cfg = testConfig({ HEALTH_DIR: FIXTURES });
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    health = new AppleHealthService(em, cfg as unknown as AppConfigService);

    account = em.create(Account, {
      email: 'user@example.com',
      label: 'тестовый',
      passwordEnc: crypto.encrypt('секрет'),
      registrationDate: '2024-03-01',
      profile: null,
      syncEnabled: true,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persistAndFlush(account);
  });

  const runImport = async (path = 'health-export.xml'): Promise<HealthImport> => {
    const started = await health.start(account.id, path);
    for (let i = 0; i < 200; i++) {
      const state = await em.fork().findOne(HealthImport, { id: started.id });
      if (state?.status === 'failed') throw new Error(`загрузка упала: ${state.error}`);
      if (state && ['done', 'cancelled'].includes(state.status)) return state;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('загрузка не завершилась за отведённое время');
  };

  it('находит файлы выгрузки в каталоге', async () => {
    const files = await health.listFiles();
    expect(files.some((file) => file.path === 'health-export.xml')).toBe(true);
  });

  it('проходит целиком и записывает итоги', async () => {
    const record = await runImport();

    expect(record.status).toBe('done');
    expect(record.error).toBeNull();
    expect(record.exportedAt).toBe('2026-08-28 14:16:29');
    expect(record.dateFrom).toBe('2024-03-01');
    expect(record.dateTo).toBe('2024-03-02');
    expect(record.workouts).toBe(2);
    expect(Number(record.bytesRead)).toBe(Number(record.sizeBytes));
    expect(record.typeCounts.StepCount).toBe(4);
  });

  it('раскладывает данные по таблицам', async () => {
    await runImport();
    const check = em.fork();

    expect(await check.count(HealthDaily, { account: account.id })).toBeGreaterThan(5);
    expect(await check.count(HealthWorkout, { account: account.id })).toBe(2);
    expect(await check.count(HealthSleep, { account: account.id })).toBe(1);
    expect(await check.count(HealthPoint, { account: account.id })).toBe(2);
  });

  it('хранит источники раздельно — их нельзя складывать', async () => {
    await runImport();
    const steps = await em
      .fork()
      .find(HealthDaily, { account: account.id, date: '2024-03-01', type: 'StepCount' });

    expect(steps.map((row) => [row.source, row.sum]).sort()).toEqual([
      ['Apple Watch', 1000],
      ['iPhone', 250],
    ]);
  });

  it('повторная загрузка заменяет предыдущую, а не удваивает', async () => {
    await runImport();
    const before = await em.fork().count(HealthDaily, { account: account.id });

    await runImport();
    const after = await em.fork().count(HealthDaily, { account: account.id });

    expect(after).toBe(before);
    expect(await em.fork().count(HealthImport, { account: account.id })).toBe(2);
  });

  it('не запускает две загрузки одного аккаунта разом', async () => {
    const first = await health.start(account.id, 'health-export.xml');
    await expect(health.start(account.id, 'health-export.xml')).rejects.toThrow(/уже идёт/);

    for (let i = 0; i < 200; i++) {
      const state = await em.fork().findOne(HealthImport, { id: first.id });
      if (state && ['done', 'failed', 'cancelled'].includes(state.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  it('отвергает путь за пределами каталога выгрузок', async () => {
    await expect(health.start(account.id, '../../../etc/passwd')).rejects.toThrow(
      /Некорректный путь|не найден/,
    );
  });

  it('внятно сообщает о несуществующем файле', async () => {
    await expect(health.start(account.id, 'нет-такого.xml')).rejects.toThrow(/не найден/);
  });
});
