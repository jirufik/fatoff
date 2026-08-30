import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import { Account, SyncRun } from '../../src/database/entities';
import { ExportsService } from '../../src/modules/exports/exports.service';
import { AppleHealthQueryService } from '../../src/modules/apple-health/health-query.service';
import { ExportLoader } from '../../src/modules/exports/loader';
import { SyncService } from '../../src/modules/sync/sync.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { FakeYazio } from '../fake-yazio';
import { buildSyntheticAccount } from '../fixtures/synthetic';
import { createTestOrm, testConfig } from '../orm-test';

const TODAY = '2026-08-10';

describe('выгрузка файлов из базы', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let fake: FakeYazio;
  let exports: ExportsService;
  let account: Account;
  let exportDir: string;

  beforeAll(async () => {
    orm = await createTestOrm('exports');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();
    exportDir = join(tmpdir(), `fatoff-exports-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    const data = buildSyntheticAccount();
    fake = new FakeYazio(data);
    const base = await fake.start();

    const cfg = testConfig({ YAZIO_API_BASE: base, EXPORT_DIR: exportDir });
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    const yazio = new YazioService(cfg as unknown as AppConfigService, crypto, em);
    const sync = new SyncService(em, cfg as unknown as AppConfigService, yazio);
    exports = new ExportsService(em, cfg as unknown as AppConfigService, new ExportLoader(em, new AppleHealthQueryService(em)));

    account = em.create(Account, {
      email: data.email,
      label: 'основной',
      passwordEnc: crypto.encrypt(data.password),
      registrationDate: '2026-08-01',
      profile: null,
      isDemo: false,
      syncEnabled: true,
      driveEnabled: false,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persistAndFlush(account);

    // база наполняется настоящей синхронизацией: экспорт проверяется на тех же
    // данных, что придут из жизни, а не на выдуманной раскладке
    const run = await sync.start(account.id, { to: TODAY });
    for (let i = 0; i < 400; i++) {
      const state = await em.fork().findOne(SyncRun, { id: run.id });
      if (state && ['done', 'failed', 'cancelled'].includes(state.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  afterEach(async () => {
    await fake.stop();
    await rm(exportDir, { recursive: true, force: true });
  });

  const fileOf = async (id: string): Promise<string> => {
    const { path } = await exports.fileFor(id);
    return readFile(path, 'utf8');
  };

  it('собирает Markdown-дайджест одним файлом', async () => {
    const record = await exports.create(account.id, {
      from: '2026-08-01',
      to: TODAY,
      formats: ['markdown'],
    });

    expect(record.status).toBe('done');
    expect(record.fileName).toMatch(/^yazio-.*-2026-08-01_2026-08-10\.md$/);
    expect(record.sizeBytes).toBeGreaterThan(0);

    const digest = await fileOf(record.id);
    expect(digest).toContain('# Выгрузка YAZIO');
    expect(digest).toContain('## Ряд по дням');
    expect(digest).toContain('Яблоко');
  });

  it('собирает JSON со всеми таблицами', async () => {
    const record = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['json'] });
    const bundle = JSON.parse(await fileOf(record.id)) as Record<string, unknown[]>;

    expect(Object.keys(bundle)).toContain('nutrition_log');
    expect(Object.keys(bundle)).toContain('daily_summary');
    expect(Object.keys(bundle)).toContain('products');
    expect(bundle.daily_summary).toHaveLength(10);

    // 150 г яблока по 0.52 ккал за грамм
    const first = (bundle.nutrition_log as Array<Record<string, unknown>>)[0];
    expect(first.product).toBe('Яблоко');
    expect(first.energy_kcal).toBe(78);
  });

  it('собирает TOON, где имена колонок написаны один раз', async () => {
    const record = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['toon'] });
    const toon = await fileOf(record.id);

    expect(toon).toMatch(/nutrition_log\[\d+\]\{date,logged_at,meal/);
    expect(toon).toContain('weight[3]{date,logged_at,weight_kg}:');
  });

  it('несколько форматов складывает в zip', async () => {
    const record = await exports.create(account.id, {
      from: '2026-08-01',
      to: TODAY,
      formats: ['markdown', 'json'],
    });

    expect(record.fileName.endsWith('.zip')).toBe(true);
    const { path } = await exports.fileFor(record.id);
    expect((await stat(path)).size).toBeGreaterThan(0);
  });

  it('CSV всегда упаковывается: по файлу на таблицу', async () => {
    const record = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['csv'] });
    expect(record.fileName.endsWith('.zip')).toBe(true);
    expect(record.tables.length).toBeGreaterThan(15);
  });

  it('две сборки на тех же данных дают одинаковый файл', async () => {
    const first = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['json'] });
    const second = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['json'] });

    const [a, b] = await Promise.all([fileOf(first.id), fileOf(second.id)]);
    // отличаться имеет право только отметка времени сборки в meta
    const strip = (text: string): string => text.replace(/"generated_at": "[^"]+"/, '');
    expect(strip(b)).toBe(strip(a));
  });

  it('обезличивание убирает опознающие поля профиля', async () => {
    const record = await exports.create(account.id, {
      from: '2026-08-01',
      to: TODAY,
      formats: ['json'],
      redact: true,
    });

    const bundle = JSON.parse(await fileOf(record.id)) as Record<string, Array<Record<string, unknown>>>;
    const profile = bundle.profile[0];
    expect(profile.email).toBeNull();
    expect(profile.uuid).toBeNull();
    expect(profile.body_height_cm).toBe(182);
  });

  it('выбор датасетов сокращает набор таблиц', async () => {
    const record = await exports.create(account.id, {
      from: '2026-08-01',
      to: TODAY,
      formats: ['json'],
      datasets: ['weight'],
    });

    const bundle = JSON.parse(await fileOf(record.id)) as Record<string, unknown[]>;
    expect(Object.keys(bundle)).toEqual(['meta', 'tables', 'weight', 'warnings']);
  });

  it('замечает расхождение с итогами YAZIO', async () => {
    const record = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['json'] });
    const bundle = JSON.parse(await fileOf(record.id)) as Record<string, Array<Record<string, unknown>>>;

    // в фикстуре 08.08 итоги намеренно разъехались, а 06.08 ссылается на пропавший продукт
    const reconcile = bundle.warnings.filter((warning) => warning.phase === 'Сверка');
    expect(reconcile.map((warning) => warning.key)).toEqual(
      expect.arrayContaining(['2026-08-06', '2026-08-08']),
    );
  });

  it('удаление выгрузки уносит и файл', async () => {
    const record = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['json'] });
    const { path } = await exports.fileFor(record.id);

    await exports.remove(record.id);
    await expect(stat(path)).rejects.toThrow();
    await expect(exports.detail(record.id)).rejects.toThrow(/не найдена/);
  });

  it('отказывается собирать перевёрнутый период', async () => {
    await expect(
      exports.create(account.id, { from: '2026-08-10', to: '2026-08-01', formats: ['json'] }),
    ).rejects.toThrow(/позже конца/);
  });

  it('срок хранения убирает старые выгрузки', async () => {
    const record = await exports.create(account.id, { from: '2026-08-01', to: TODAY, formats: ['json'] });
    await em
      .getConnection()
      .execute('update export_file set created_at = now() - interval \'60 days\' where id = ?', [record.id]);

    expect(await exports.cleanup()).toBe(1);
    expect(await exports.list()).toHaveLength(0);
  });
});
