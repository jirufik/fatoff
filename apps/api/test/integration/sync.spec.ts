import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CryptoService } from '../../src/common/crypto.service';
import { SyncSchedule } from '../../src/modules/schedule/sync.schedule';
import type { AppConfigService } from '../../src/config/app-config.service';
import {
  Account,
  AccountSnapshot,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  ProductCache,
  RecipeCache,
  SyncRun,
  SyncWarning,
} from '../../src/database/entities';
import { SyncService } from '../../src/modules/sync/sync.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { FakeYazio } from '../fake-yazio';
import { buildSyntheticAccount } from '../fixtures/synthetic';
import { createTestOrm, testConfig } from '../orm-test';

const TODAY = '2026-08-10';

describe('синхронизация: от YAZIO до базы', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let fake: FakeYazio;
  let sync: SyncService;
  let cfg: ReturnType<typeof testConfig>;
  let account: Account;
  let schedule: SyncSchedule;

  beforeAll(async () => {
    orm = await createTestOrm('sync');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();

    const data = buildSyntheticAccount();
    fake = new FakeYazio(data);
    const base = await fake.start();

    cfg = testConfig({ YAZIO_API_BASE: base });
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    const yazio = new YazioService(cfg as unknown as AppConfigService, crypto, em);
    sync = new SyncService(em, cfg as unknown as AppConfigService, yazio);
    schedule = new SyncSchedule(em, cfg as unknown as AppConfigService, sync);

    account = em.create(Account, {
      email: data.email,
      label: 'тестовый',
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
  });

  afterEach(async () => {
    await fake.stop();
  });

  // ── расписание у каждого аккаунта своё ───────────────────────────────────

  /** Синхронизация уходит в фон; тесту расписания нужен её конец. */
  const settle = async (): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const active = await em.fork().findOne(SyncRun, { status: { $in: ['queued', 'running'] } });
      if (!active) return;
      await new Promise((done) => setTimeout(done, 50));
    }
  };

  const at = (hours: number, minutes: number): Date => new Date(2026, 7, 29, hours, minutes);

  it('запускает синхронизацию в назначенное аккаунту время', async () => {
    account.syncDailyAt = '06:30';
    await em.flush();

    expect(await schedule.runDue(at(6, 29))).toEqual([]);
    expect(await schedule.runDue(at(6, 30))).toEqual([account.id]);

    await settle();
    const run = await em.fork().findOne(SyncRun, { account: account.id }, { orderBy: { startedAt: 'desc' } });
    expect(run?.status).toBe('done');
  });

  it('в ту же минуту второй раз не запускает', async () => {
    account.syncDailyAt = '06:30';
    await em.flush();

    expect(await schedule.runDue(at(6, 30))).toEqual([account.id]);
    await settle();
    // часы могут дёрнуться назад по NTP — минута наступит дважды
    expect(await schedule.runDue(at(6, 30))).toEqual([]);
  });

  it('аккаунт без времени сам не синхронизируется вовсе', async () => {
    account.syncDailyAt = null;
    await em.flush();

    for (let hour = 0; hour < 24; hour++) {
      expect(await schedule.runDue(at(hour, 0))).toEqual([]);
    }
    expect(await em.fork().count(SyncRun, {})).toBe(0);
  });

  it('выключенный аккаунт не трогает, даже если время его', async () => {
    account.syncDailyAt = '06:30';
    account.syncEnabled = false;
    await em.flush();

    expect(await schedule.runDue(at(6, 30))).toEqual([]);
  });

  it('не начинает второй прогон поверх идущего', async () => {
    account.syncDailyAt = '06:30';
    await em.flush();
    em.create(SyncRun, {
      account,
      status: 'running',
      mode: 'incremental',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-29',
      datasets: [],
      startedAt: new Date(),
    } as never);
    await em.flush();

    // второй прогон поверх идущего упёрся бы в лимиты YAZIO и перезаписал бы
    // друг другу дни: расписание такое пропускает
    expect(await schedule.runDue(at(6, 30))).toEqual([]);
  });


  /** Синхронно прогоняет запуск целиком — start() уходит в фон, а тесту нужен итог. */
  const runSync = async (request: Parameters<SyncService['start']>[1] = {}): Promise<SyncRun> => {
    const started = await sync.start(account.id, { to: TODAY, ...request });
    // start уже запустил execute в фоне; дожидаемся завершения по статусу
    for (let i = 0; i < 200; i++) {
      const run = await em.fork().findOne(SyncRun, { id: started.id });
      if (run && ['done', 'failed', 'cancelled'].includes(run.status)) return run;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('синхронизация не завершилась за отведённое время');
  };

  it('первый прогон наполняет базу', async () => {
    const run = await runSync();
    expect(run.status).toBe('done');
    expect(run.error).toBeNull();

    const check = em.fork();

    // дни: восемь с записями, два пустых (04 и 07) в план не попали
    const snapshots = await check.find(DaySnapshot, { account: account.id }, { orderBy: { date: 'asc' } });
    expect(snapshots.map((s) => s.date)).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-05',
      '2026-08-06', '2026-08-08', '2026-08-09', '2026-08-10',
    ]);

    // дневник сохранён сырьём, как пришёл
    const first = snapshots[0];
    expect((first.consumed as { products: unknown[] }).products).toHaveLength(2);
    expect(first.water).toEqual({ water_intake: 1500 });
    expect(first.goals).toMatchObject({ 'energy.energy': 1900 });

    // 404 на воде — это «не пили», а не сбой: поле пустое, предупреждения нет
    const dry = snapshots.find((s) => s.date === '2026-08-02')!;
    expect(dry.water).toEqual({});

    expect(await check.count(DailyNutrients, { account: account.id })).toBe(8);
    expect(await check.count(ProductCache, { account: account.id })).toBe(3);
    expect(await check.count(RecipeCache, { account: account.id })).toBe(2);
    expect(await check.count(DailyExercise, { account: account.id })).toBe(2);
    expect(await check.count(BodyValue, { account: account.id })).toBe(4);

    const kinds = (await check.find(AccountSnapshot, { account: account.id })).map((s) => s.kind).sort();
    expect(kinds).toEqual(['dietary_preferences', 'fasting', 'settings', 'streak', 'subscription', 'user']);

    // профиль осел в аккаунте — из него дайджест берёт пол, рост и цель
    const stored = await check.findOneOrFail(Account, { id: account.id });
    expect(stored.profile).toMatchObject({ sex: 'male', body_height: 182 });
    expect(stored.lastSyncStatus).toBe('ok');
  });

  it('пользовательский рецепт найден после 404 на публичном', async () => {
    await runSync();
    const recipes = await em.fork().find(RecipeCache, { account: account.id }, { orderBy: { recipeId: 'asc' } });
    expect(recipes.map((r) => [r.recipeId, r.isUserRecipe])).toEqual([
      ['r-soup', false],
      ['ur-omelette', true],
    ]);
  });

  it('повторный прогон не перекачивает то, что не изменилось', async () => {
    await runSync();
    fake.reset();

    const run = await runSync();
    expect(run.status).toBe('done');
    expect(run.daysTotal).toBe(0);
    expect(fake.countOf('consumed-items?date=')).toBe(0);
    // карточки продуктов уже в кэше; повторно спрашивается только пропавшая —
    // на случай, если её отсутствие было временным
    expect(fake.countOf('/products/')).toBe(1);
    // а дешёвый детектор изменений спрашивается всегда
    expect(fake.countOf('nutrients-daily')).toBe(1);
  });

  it('перекачивает день, у которого изменились итоги', async () => {
    await runSync();
    fake.reset();

    const day = buildSyntheticAccount().dailyNutrients.find((d) => d.date === '2026-08-02')!;
    Object.assign(day, { energy: (day.energy ?? 0) + 500 });
    // подменяем итоги в подставном YAZIO так, будто пользователь дописал еду
    const data = (fake as unknown as { data: ReturnType<typeof buildSyntheticAccount> }).data;
    const target = data.dailyNutrients.find((d) => d.date === '2026-08-02')!;
    target.energy = (target.energy ?? 0) + 500;

    const run = await runSync();
    expect(run.daysTotal).toBe(1);
    expect(fake.countOf('consumed-items?date=2026-08-02')).toBe(1);
    expect(fake.countOf('consumed-items?date=2026-08-01')).toBe(0);
  });

  it('всегда перепроверяет хвост последних дней', async () => {
    await runSync();
    fake.reset();
    cfg.set('YAZIO_RESYNC_DAYS', 3);

    // «сегодня» настоящее, поэтому хвост попадёт в период только если он в него входит
    const run = await runSync({ to: new Date().toISOString().slice(0, 10) });
    expect(run.daysTotal).toBeGreaterThan(0);
  });

  it('сбой одного дня становится предупреждением, а не концом выгрузки', async () => {
    fake.failNext('consumed-items?date=2026-08-03', 500, 5);

    const run = await runSync();
    expect(run.status).toBe('done');
    expect(run.warningsCount).toBeGreaterThan(0);

    const warnings = await em.fork().find(SyncWarning, { run: run.id });
    expect(warnings.some((w) => w.key === '2026-08-03' && w.status === 500)).toBe(true);

    // остальные дни на месте
    expect(await em.fork().count(DaySnapshot, { account: account.id })).toBe(8);
  });

  it('пропавший продукт не роняет день', async () => {
    const run = await runSync();
    const warnings = await em.fork().find(SyncWarning, { run: run.id });
    expect(warnings.some((w) => w.key === 'p-vanished' && w.status === 404)).toBe(true);
    expect(run.status).toBe('done');
  });

  it('протухший токен обновляется на ходу и выгрузка продолжается', async () => {
    // токен, с которым клиент придёт первым запросом, уже не тот
    account.accessTokenEnc = new CryptoService(cfg as unknown as AppConfigService).encrypt('stale-access-token');
    account.refreshTokenEnc = new CryptoService(cfg as unknown as AppConfigService).encrypt('refresh-1');
    await em.flush();

    const run = await runSync();
    expect(run.status).toBe('done');
    expect(await em.fork().count(DaySnapshot, { account: account.id })).toBe(8);
  });

  it('неверный пароль роняет прогон с понятной ошибкой', async () => {
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    account.passwordEnc = crypto.encrypt('не тот пароль');
    account.accessTokenEnc = null;
    account.refreshTokenEnc = null;
    await em.flush();

    const run = await runSync();
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/не приняты/i);

    const stored = await em.fork().findOneOrFail(Account, { id: account.id });
    expect(stored.lastSyncStatus).toBe('failed');
  });

  it('не запускает две синхронизации одного аккаунта разом', async () => {
    const first = await sync.start(account.id, { to: TODAY });
    await expect(sync.start(account.id, { to: TODAY })).rejects.toThrow(/уже идёт/);

    for (let i = 0; i < 200; i++) {
      const run = await em.fork().findOne(SyncRun, { id: first.id });
      if (run && ['done', 'failed', 'cancelled'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  it('выбор датасетов сокращает число запросов', async () => {
    const run = await runSync({ datasets: ['weight'] });
    expect(run.status).toBe('done');
    expect(fake.countOf('consumed-items?date=')).toBe(0);
    expect(fake.countOf('bodyvalues/weight')).toBe(1);
    expect(fake.countOf('bodyvalues/body_fat')).toBe(0);
    expect(await em.fork().count(BodyValue, { account: account.id })).toBe(3);
  });

  it('режим «все дни» проходит и пустые даты', async () => {
    const run = await runSync({ from: '2026-08-01', to: '2026-08-10', allDays: true });
    expect(run.daysTotal).toBe(10);
    expect(await em.fork().count(DaySnapshot, { account: account.id })).toBe(10);
  });
});
