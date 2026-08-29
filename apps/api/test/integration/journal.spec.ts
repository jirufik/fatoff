import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import {
  Account,
  BodyValue,
  HealthDaily,
  HealthSleep,
  HealthWorkout,
  SyncRun,
} from '../../src/database/entities';
import { JournalService } from '../../src/modules/journal/journal.service';
import { AccountFactsService } from '../../src/modules/planner/facts.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { FakeYazio } from '../fake-yazio';
import { buildSyntheticAccount } from '../fixtures/synthetic';
import { createTestOrm, testConfig } from '../orm-test';

const TODAY = '2026-08-10';

describe('день целиком', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let fake: FakeYazio;
  let journal: JournalService;
  let account: Account;

  beforeAll(async () => {
    orm = await createTestOrm('journal');
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

    const cfg = testConfig({ YAZIO_API_BASE: base });
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    const yazio = new YazioService(cfg as unknown as AppConfigService, crypto, em);
    const sync = new SyncService(em, cfg as unknown as AppConfigService, yazio);
    journal = new JournalService(em, new AccountFactsService(em));

    account = em.create(Account, {
      email: data.email,
      label: 'тестовый',
      passwordEnc: crypto.encrypt(data.password),
      registrationDate: '2026-08-01',
      profile: { sex: 'female', date_of_birth: '1990-06-04', body_height: 165 },
      syncEnabled: true,
      driveEnabled: false,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persistAndFlush(account);

    // база наполняется настоящей синхронизацией: журнал проверяется на тех же
    // данных, что придут из жизни, а не на выдуманной раскладке
    const run = await sync.start(account.id, { to: TODAY });
    for (let i = 0; i < 400; i++) {
      const state = await em.fork().findOne(SyncRun, { id: run.id });
      if (state && ['done', 'failed', 'cancelled'].includes(state.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    await addHealth(em, account, '2026-08-01');
    // день, о котором знают только часы: дневника за него нет
    await setBurn(em, account, '2026-07-31', 420, 1310);
  });

  afterEach(async () => {
    await fake.stop();
  });

  it('сводит обе половины дня в одну строку', async () => {
    const page = await journal.days(account.id, { from: '2026-08-01', to: '2026-08-01' });
    const [day] = page.items;

    // яблоко 150 г по 0.52 плюс белый хлеб 90 г по 2.65
    expect(day.energyInKcal).toBe(316.5);
    expect(day.proteinG).toBe(8.5);
    expect(day.fiberG).toBe(6);
    expect(day.meals).toBe(2);
    expect(day.entries).toBe(2);

    expect(day.activeKcal).toBe(500);
    expect(day.basalKcal).toBe(1300);
    expect(day.energyOutKcal).toBe(1800);
    expect(day.steps).toBe(12_000);
    expect(day.workouts).toBe(2);
    expect(day.workoutKcal).toBe(310);
    expect(day.asleepMin).toBe(450);
    expect(day.weightKg).toBe(52);
  });

  it('баланс считается и раскрашивается на сервере', async () => {
    const page = await journal.days(account.id, { from: '2026-08-01', to: '2026-08-01' });
    expect(page.items[0].balanceKcal).toBe(-1483.5);
    expect(page.items[0].balance).toBe('deficit');
  });

  it('«ноль» — коридор в сотню килокалорий, а не точка', async () => {
    // за 02.08 съедено 913.9 ккал; расход 960 — разница в полсотни, это ровно
    await setBurn(em, account, '2026-08-02', 60, 900);
    const page = await journal.days(account.id, { from: '2026-08-02', to: '2026-08-02' });
    expect(page.items[0].balanceKcal).toBe(-46.1);
    expect(page.items[0].balance).toBe('even');
  });

  it('день без данных Apple Health не получает придуманного баланса', async () => {
    const page = await journal.days(account.id, { from: '2026-08-02', to: '2026-08-02' });
    expect(page.items[0].energyOutKcal).toBeNull();
    expect(page.items[0].balanceKcal).toBeNull();
    expect(page.items[0].balance).toBeNull();
  });

  it('сумма приёмов пищи равна итогу дня, а сумма позиций — итогу приёма', async () => {
    const detail = await journal.day(account.id, '2026-08-01');
    const fromMeals = detail.meals.reduce((sum, meal) => sum + (meal.energyKcal ?? 0), 0);
    expect(Math.round(fromMeals * 10) / 10).toBe(316.5);

    for (const meal of detail.meals) {
      const fromItems = meal.items.reduce((sum, item) => sum + (item.energyKcal ?? 0), 0);
      expect(Math.round(fromItems * 10) / 10).toBe(meal.energyKcal);
    }
  });

  it('приёмы пищи идут в порядке дня, а не по алфавиту', async () => {
    const detail = await journal.day(account.id, '2026-08-01');
    expect(detail.meals.map((meal) => meal.meal)).toEqual(['breakfast', 'lunch']);
    // подписи переводит интерфейс: сервер сообщает только ключ приёма пищи
  });

  it('раскрывает состав приёма пищи с граммовкой и порцией', async () => {
    const detail = await journal.day(account.id, '2026-08-01');
    const [apple] = detail.meals[0].items;

    expect(apple.name).toBe('Яблоко');
    expect(apple.amount).toBe(150);
    expect(apple.unit).toBe('g');
    expect(apple.serving).toBe('piece');
    expect(apple.energyKcal).toBe(78);
    expect(apple.kind).toBe('product');
  });

  it('разбирает расход по составляющим и отдаёт вид каждой тренировки', async () => {
    const detail = await journal.day(account.id, '2026-08-01');

    expect(detail.burn.basalKcal).toBe(1300);
    expect(detail.burn.activeKcal).toBe(500);
    expect(detail.burn.totalKcal).toBe(1800);
    expect(detail.burn.workoutKcal).toBe(310);
    expect(detail.burn.steps).toBe(12_000);

    expect(detail.workouts).toHaveLength(2);
    expect(detail.workouts.map((workout) => workout.type)).toEqual([
      'Walking',
      'TraditionalStrengthTraining',
    ]);
    expect(detail.workouts[0].durationMin).toBe(60);
    expect(detail.workouts[0].energyKcal).toBe(150);
  });

  it('оценка дня приходит с разбором по составляющим', async () => {
    const detail = await journal.day(account.id, '2026-08-01');

    expect(detail.score.total).not.toBeNull();
    expect(detail.score.covered).toBe(6);
    expect(detail.score.parts.map((part) => part.key)).toEqual([
      'balance',
      'protein',
      'fiber',
      'steps',
      'exercise',
      'sleep',
    ]);
    // 12 000 шагов при цели 10 000 — полный вес
    expect(detail.score.parts.find((part) => part.key === 'steps')!.earned).toBe(15);
  });

  it('день, о котором знают только часы, всё равно виден', async () => {
    const page = await journal.days(account.id, { from: '2026-07-31', to: '2026-07-31' });
    const [day] = page.items;

    expect(day.energyOutKcal).toBe(1730);
    expect(day.entries).toBe(0);
    expect(day.energyInKcal).toBeNull();
    // приход неизвестен — баланса нет, а не «съедено ноль»
    expect(day.balanceKcal).toBeNull();
  });

  it('фильтр «только с едой» убирает дни без записей', async () => {
    const all = await journal.days(account.id, { pageSize: 100 });
    const withFood = await journal.days(account.id, { pageSize: 100, withFood: true });

    expect(withFood.total).toBe(all.total - 1);
    expect(withFood.items.every((day) => day.entries > 0)).toBe(true);
  });

  it('фильтр «обе половины» оставляет только дни с балансом', async () => {
    const withFood = await journal.days(account.id, { pageSize: 100, withFood: true });
    const both = await journal.days(account.id, { pageSize: 100, withBalance: true });

    // дней с едой не меньше: расход известен не за каждый съеденный день
    expect(both.total).toBeLessThanOrEqual(withFood.total);
    expect(both.total).toBeGreaterThan(0);

    for (const day of both.items) {
      // ради этих дней всё и делалось: известны и приход, и расход
      expect({
        date: day.date,
        eaten: day.energyInKcal !== null && day.entries > 0,
        spent: day.energyOutKcal !== null,
        balance: day.balanceKcal !== null,
      }).toEqual({ date: day.date, eaten: true, spent: true, balance: true });
    }
  });

  it('сортирует по балансу и держит страницу', async () => {
    const page = await journal.days(account.id, { sort: 'balance', dir: 'asc', pageSize: 3 });
    expect(page.pageSize).toBe(3);
    expect(page.items).toHaveLength(3);
    // строка с посчитанным балансом идёт раньше строк без него
    expect(page.items[0].balanceKcal).not.toBeNull();
  });

  it('день, о котором нет вообще ничего, отдаёт пустой состав, а не падает', async () => {
    const detail = await journal.day(account.id, '2026-07-01');
    expect(detail.meals).toEqual([]);
    expect(detail.workouts).toEqual([]);
    expect(detail.burn.totalKcal).toBeNull();
    expect(detail.score.total).toBeNull();
  });
});

/** Известные числа Apple Health на один день: тест должен проверять их, а не угадывать. */
async function addHealth(em: EntityManager, account: Account, date: string): Promise<void> {
  const fork = em.fork();
  const daily = (type: string, sum: number, avg: number | null = null, samples = 1): HealthDaily =>
    fork.create(HealthDaily, {
      account,
      date,
      type,
      source: 'Часы',
      unit: null,
      samples,
      sum,
      min: null,
      max: null,
      avg,
    });

  fork.persist([
    daily('StepCount', 12_000),
    daily('ActiveEnergyBurned', 500),
    daily('BasalEnergyBurned', 1300),
    daily('AppleExerciseTime', 45),
    daily('DistanceWalkingRunning', 8.4),
    daily('RestingHeartRate', 0, 58),
    // второй источник того же дня: складывать нельзя, берётся больший
    fork.create(HealthDaily, {
      account,
      date,
      type: 'StepCount',
      source: 'Телефон',
      unit: null,
      samples: 1,
      sum: 9000,
      min: null,
      max: null,
      avg: null,
    }),
  ]);

  fork.persist([
    fork.create(HealthWorkout, {
      account,
      date,
      startedAt: `${date} 07:00:00`,
      endedAt: `${date} 08:00:00`,
      type: 'Walking',
      durationMin: 60,
      energyKcal: 150,
      distanceKm: 5.2,
      source: 'Часы',
    }),
    fork.create(HealthWorkout, {
      account,
      date,
      startedAt: `${date} 18:00:00`,
      endedAt: `${date} 18:45:00`,
      type: 'TraditionalStrengthTraining',
      durationMin: 45,
      energyKcal: 160,
      distanceKm: null,
      source: 'Часы',
    }),
  ]);

  fork.persist(
    fork.create(HealthSleep, {
      account,
      night: date,
      source: 'Часы',
      inBedMin: 480,
      asleepMin: 450,
      deepMin: 70,
      remMin: 90,
      coreMin: 290,
      awakeMin: 30,
      fellAsleepAt: `${date} 23:10:00`,
      wokeAt: `${date} 07:00:00`,
    }),
  );

  fork.persist(
    fork.create(BodyValue, {
      account,
      kind: 'weight',
      loggedAt: `${date} 07:30:00`,
      date,
      value: 52,
    }),
  );

  await fork.flush();
}

/** Расход одного дня заданными числами — так проверяются коридор баланса и дни без дневника. */
async function setBurn(
  em: EntityManager,
  account: Account,
  date: string,
  active: number,
  basal: number,
): Promise<void> {
  const fork = em.fork();
  fork.persist([
    fork.create(HealthDaily, {
      account,
      date,
      type: 'ActiveEnergyBurned',
      source: 'Часы',
      unit: null,
      samples: 1,
      sum: active,
      min: null,
      max: null,
      avg: null,
    }),
    fork.create(HealthDaily, {
      account,
      date,
      type: 'BasalEnergyBurned',
      source: 'Часы',
      unit: null,
      samples: 1,
      sum: basal,
      min: null,
      max: null,
      avg: null,
    }),
  ]);
  await fork.flush();
}
