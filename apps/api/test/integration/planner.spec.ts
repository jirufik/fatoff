import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { GenerateRequest } from '@fatoff/contracts';

import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import { Account, HealthDaily, HealthWorkout, SyncRun } from '../../src/database/entities';
import { AccountFactsService } from '../../src/modules/planner/facts.service';
import { buildPlanPdf } from '../../src/modules/planner/plan-pdf';
import { PlannerService } from '../../src/modules/planner/planner.service';
import { clampPlannerSettings } from '../../src/modules/planner/settings';
import { SyncService } from '../../src/modules/sync/sync.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { FakeYazio } from '../fake-yazio';
import { buildSyntheticAccount } from '../fixtures/synthetic';
import { createTestOrm, testConfig } from '../orm-test';

const TODAY = '2026-08-10';

/**
 * Отбор пула ослаблен и развязан от календаря: в синтетическом аккаунте десять
 * дней, а тест не должен начать падать оттого, что настал следующий год.
 */
const ALGORITHM = { poolMinEntries: 1, poolLastUsedMonths: 120 };

describe('генератор режима', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let fake: FakeYazio;
  let planner: PlannerService;
  let account: Account;

  beforeAll(async () => {
    orm = await createTestOrm('planner');
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
    planner = new PlannerService(em, new AccountFactsService(em));

    account = em.create(Account, {
      email: data.email,
      label: 'тестовый',
      passwordEnc: crypto.encrypt(data.password),
      registrationDate: '2026-08-01',
      profile: { sex: 'female', date_of_birth: '1990-06-04', body_height: 165 },
      isDemo: false,
      syncEnabled: true,
      driveEnabled: false,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persistAndFlush(account);

    const run = await sync.start(account.id, { to: TODAY });
    for (let i = 0; i < 400; i++) {
      const state = await em.fork().findOne(SyncRun, { id: run.id });
      if (state && ['done', 'failed', 'cancelled'].includes(state.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    await addHealth(em, account);
  });

  afterEach(async () => {
    await fake.stop();
  });

  const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
    from: '2026-08-17',
    to: '2026-08-23',
    training: { mode: 'current' },
    algorithm: ALGORITHM,
    seed: 42,
    ...over,
  });

  // ── нормы ────────────────────────────────────────────────────────────────

  it('считает нормы от её данных и показывает цели YAZIO рядом', async () => {
    const targets = await planner.targets(account.id);

    expect(targets.profile.weightKg).toBe(73.8);
    expect(targets.profile.bodyFatPct).toBe(22.5);
    expect(targets.expenditure.totalKcal).toBe(2400);
    expect(targets.computed.energyKcal).toBeGreaterThan(0);
    // цели из последнего дня, где они правда заданы: 03.08, а не пустой объект позже
    expect(targets.yazio.energyKcal).toBe(1850);
    expect(targets.yazio.proteinG).toBe(100);
    expect(targets.diff.energyKcal).toBe(
      (targets.computed.energyKcal ?? 0) - (targets.yazio.energyKcal ?? 0),
    );
  });

  it('темп снижения двигает дефицит и целевые калории', async () => {
    const slow = await planner.targets(account.id, { lossRatePctPerWeek: 0.3 });
    const fast = await planner.targets(account.id, { lossRatePctPerWeek: 1 });

    expect(fast.deficitKcal).toBeGreaterThan(slow.deficitKcal ?? 0);
    expect(fast.computed.energyKcal).toBeLessThan(slow.computed.energyKcal ?? 0);
  });

  // ── пул ──────────────────────────────────────────────────────────────────

  it('собирает пул из её же дневника', async () => {
    const pool = await planner.pool(account.id, ALGORITHM);

    expect(pool.length).toBeGreaterThan(0);
    expect(pool.map((item) => item.name)).toContain('Яблоко');
    // быстрые записи в пул не идут: повторить их нельзя
    expect(pool.map((item) => item.name)).not.toContain('Ужин в гостях');

    const apple = pool.find((item) => item.name === 'Яблоко')!;
    expect(apple.kind).toBe('product');
    expect(apple.per.energyKcal).toBeCloseTo(0.52, 3);
    expect(apple.typicalAmount).toBeGreaterThan(0);
  });

  it('строгий отбор оставляет пул пустым и генератор об этом говорит', async () => {
    const plan = await planner.generate(
      account.id,
      request({ algorithm: { poolMinEntries: 50, poolLastUsedMonths: 120 } }),
    );
    expect(plan.warnings.map((item) => item.code)).toContain('plan.empty-pool');
  });

  // ── генерация ────────────────────────────────────────────────────────────

  it('собирает план на неделю с меню и тренировками', async () => {
    const plan = await planner.generate(account.id, request());

    expect(plan.days).toHaveLength(7);
    expect(plan.summary.days).toBe(7);
    expect(plan.days[0].meals.length).toBeGreaterThan(0);
    expect(plan.summary.workouts).toBeGreaterThan(0);
    // хотя бы один день полного отдыха
    expect(plan.summary.restDays).toBeGreaterThanOrEqual(1);
  });

  it('одно зерно — один и тот же план', async () => {
    const first = await planner.generate(account.id, request());
    const second = await planner.generate(account.id, request());
    expect(JSON.stringify(second.days)).toBe(JSON.stringify(first.days));
  });

  it('итог дня равен сумме приёмов, а приём — сумме позиций', async () => {
    const [day] = (await planner.generate(account.id, request())).days;

    const fromMeals = day.meals.reduce((sum, meal) => sum + (meal.totals.energyKcal ?? 0), 0);
    expect(Math.abs(fromMeals - (day.totals.energyKcal ?? 0))).toBeLessThanOrEqual(day.meals.length);

    for (const meal of day.meals) {
      const fromItems = meal.items.reduce((sum, item) => sum + item.energyKcal, 0);
      expect(Math.abs(fromItems - (meal.totals.energyKcal ?? 0))).toBeLessThanOrEqual(meal.items.length);
    }
  });

  it('в дне плана есть прикидка расхода и баланс', async () => {
    const plan = await planner.generate(account.id, request());
    const training = plan.days.find((day) => day.workoutKcal > 0)!;
    const rest = plan.days.find((day) => day.workouts.length === 0)!;

    // базальные 1700 плюс обычное движение: активные 700 минус тренировки
    expect(rest.burnKcal).toBeGreaterThan(1700);
    expect(rest.balanceKcal).toBe((rest.totals.energyKcal ?? 0) - (rest.burnKcal ?? 0));
    expect(['deficit', 'even', 'surplus']).toContain(rest.balance);

    // в тренировочный день расход выше ровно на энергию занятий
    expect(training.burnKcal! - rest.burnKcal!).toBe(training.workoutKcal);
  });

  it('виды тренировок едут с планом вместе с ценой минуты', async () => {
    const plan = await planner.generate(account.id, request());

    expect(plan.workoutTypes.length).toBeGreaterThan(0);
    const walking = plan.workoutTypes.find((type) => type.type === 'Walking')!;
    expect(walking.group).toBe('cardio');
    // в фикстуре ходьба — 60 минут на 150 ккал
    expect(walking.kcalPerMin).toBeCloseTo(2.5, 1);
  });

  it('пересчёт с другой энергией тренировки двигает расход и баланс', async () => {
    const plan = await planner.generate(account.id, request());
    const [day] = plan.days;
    const meals = day.meals.map((meal) => ({
      meal: meal.meal,
      items: meal.items.map((item) => ({ key: item.key, amount: item.amount })),
    }));

    const rest = await planner.recost(account.id, {
      date: day.date,
      workoutKcal: 0,
      algorithm: ALGORITHM,
      meals,
    });
    const heavy = await planner.recost(account.id, {
      date: day.date,
      workoutKcal: 400,
      algorithm: ALGORITHM,
      meals,
    });

    expect(heavy.burnKcal! - rest.burnKcal!).toBe(400);
    expect(heavy.balanceKcal!).toBe(rest.balanceKcal! - 400);
  });

  it('по умолчанию все дни плана одинаковы по целевым калориям', async () => {
    // ровные дни — то, что просили (D-074): тренировка цель больше не двигает
    const plan = await planner.generate(account.id, request());
    const energies = new Set(plan.days.map((day) => day.targets.energyKcal));
    expect(energies.size).toBe(1);
  });

  it('включённая прибавка снова поднимает тренировочный день', async () => {
    const plan = await planner.generate(
      account.id,
      request({ targets: { addWorkoutEnergy: true } }),
    );
    const training = plan.days.find((day) => day.workoutKcal > 0);
    const rest = plan.days.find((day) => day.workouts.length === 0);

    expect(training).toBeDefined();
    expect(rest).toBeDefined();
    expect(training!.targets.energyKcal).toBeGreaterThan(rest!.targets.energyKcal ?? 0);
  });

  it('приёмы берутся из дневника целиком, а не собираются из блюд', async () => {
    const plan = await planner.generate(account.id, request());
    // перекусов в синтетическом дневнике нет вовсе, и брать их неоткуда:
    // проверяются те приёмы, для которых каталог есть
    const meals = plan.days.flatMap((day) => day.meals).filter((meal) => meal.meal !== 'snack');

    expect(meals.length).toBeGreaterThan(0);
    expect(meals.every((meal) => Boolean(meal.comboFrom))).toBe(true);
  });

  it('перекус — самый лёгкий приём дня', async () => {
    const plan = await planner.generate(account.id, request());

    for (const day of plan.days) {
      const snack = day.meals.find((meal) => meal.meal === 'snack');
      const main = day.meals.filter((meal) => meal.meal !== 'snack');
      expect(snack).toBeDefined();
      expect(snack!.totals.energyKcal ?? 0).toBeLessThanOrEqual(
        Math.min(...main.map((meal) => meal.totals.energyKcal ?? 0)),
      );
    }
  });

  it('в завтрак не попадает еда обедов и ужинов', async () => {
    const [plan, pool] = await Promise.all([
      planner.generate(account.id, request()),
      planner.pool(account.id, ALGORITHM),
    ]);
    const byKey = new Map(pool.map((item) => [item.key, item]));

    for (const day of plan.days) {
      const breakfast = day.meals.find((meal) => meal.meal === 'breakfast');
      for (const item of breakfast?.items ?? []) {
        expect(byKey.get(item.key)?.meals).toContain('breakfast');
      }
    }
  });

  it('выбор приёмов пищи сокращает день', async () => {
    const plan = await planner.generate(
      account.id,
      request({ meals: ['breakfast', 'lunch', 'dinner'] }),
    );
    for (const day of plan.days) {
      expect(day.meals.map((meal) => meal.meal)).toEqual(['breakfast', 'lunch', 'dinner']);
    }
  });

  it('возвращает применённые настройки, а не только переданные', async () => {
    const plan = await planner.generate(account.id, request({ targets: { proteinPerKg: 2 } }));

    expect(plan.resolved.targets.proteinPerKg).toBe(2);
    // остальное подставлено по умолчанию
    expect(plan.resolved.targets.fiberPer1000Kcal).toBe(14);
    expect(plan.resolved.algorithm.beamWidth).toBe(24);
    expect(plan.seed).toBe(42);
  });

  it('отказывается собирать перевёрнутый и слишком длинный период', async () => {
    await expect(
      planner.generate(account.id, request({ from: '2026-08-23', to: '2026-08-17' })),
    ).rejects.toThrow(/позже конца/);

    await expect(
      planner.generate(account.id, request({ from: '2026-01-01', to: '2026-12-31' })),
    ).rejects.toThrow(/длиннее/);
  });

  it('настройки из браузера приводятся к границам справочника', () => {
    const clamped = clampPlannerSettings({
      targets: { lossRatePctPerWeek: 99 },
      algorithm: { beamWidth: 100_000, poolMinEntries: -5, unknownKnob: 1 } as never,
    });

    expect(clamped.targets?.lossRatePctPerWeek).toBe(1.5);
    expect(clamped.algorithm?.beamWidth).toBe(128);
    expect(clamped.algorithm?.poolMinEntries).toBe(1);
    expect(clamped.algorithm).not.toHaveProperty('unknownKnob');
  });

  // ── свой набор блюд, закрепление, пересчёт ───────────────────────────────

  it('пул можно сузить периодом дневника', async () => {
    const all = await planner.pool(account.id, ALGORITHM);
    const narrow = await planner.pool(account.id, ALGORITHM, { from: '2026-08-01', to: '2026-08-02' });

    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.length).toBeLessThan(all.length);
    for (const item of narrow) expect(item.lastUsed! <= '2026-08-02').toBe(true);
  });

  it('пул можно свести к отмеченным блюдам', async () => {
    const all = await planner.pool(account.id, ALGORITHM);
    const one = all[0].key;

    const picked = await planner.pool(account.id, ALGORITHM, { keys: [one] });
    expect(picked.map((item) => item.key)).toEqual([one]);
  });

  it('закреплённое блюдо стоит в каждом дне периода', async () => {
    const pool = await planner.pool(account.id, ALGORITHM);
    const apple = pool.find((item) => item.name === 'Яблоко')!;

    const plan = await planner.generate(
      account.id,
      request({ pinned: [{ meal: 'lunch', key: apple.key, amount: 200 }] }),
    );

    for (const day of plan.days) {
      const lunch = day.meals.find((meal) => meal.meal === 'lunch')!;
      expect(lunch.items[0].name).toBe('Яблоко');
      expect(lunch.items[0].amount).toBe(200);
      expect(lunch.items[0].pinned).toBe(true);
    }
  });

  it('закреплённое блюдо с датой стоит только в своём дне', async () => {
    const pool = await planner.pool(account.id, ALGORITHM);
    const apple = pool.find((item) => item.name === 'Яблоко')!;

    const plan = await planner.generate(
      account.id,
      request({ pinned: [{ date: '2026-08-19', meal: 'dinner', key: apple.key }] }),
    );

    for (const day of plan.days) {
      const dinner = day.meals.find((meal) => meal.meal === 'dinner')!;
      const first = dinner.items[0]?.pinned === true;
      expect(first).toBe(day.date === '2026-08-19');
    }
  });

  it('пересчитывает день после замены блюда', async () => {
    const plan = await planner.generate(account.id, request());
    const [day] = plan.days;

    const recost = await planner.recost(account.id, {
      date: day.date,
      workoutKcal: day.workoutKcal,
      algorithm: ALGORITHM,
      meals: day.meals.map((meal) => ({
        meal: meal.meal,
        items: meal.items.map((item) => ({ key: item.key, amount: item.amount })),
      })),
    });

    // тот же состав — те же числа
    expect(recost.totals.energyKcal).toBe(day.totals.energyKcal);
    expect(recost.targets.energyKcal).toBe(day.targets.energyKcal);

    // удвоили граммовку первой позиции завтрака — итог вырос
    const meals = day.meals.map((meal, index) => ({
      meal: meal.meal,
      items: meal.items.map((item, i) => ({
        key: item.key,
        amount: index === 0 && i === 0 ? item.amount * 2 : item.amount,
      })),
    }));
    const heavier = await planner.recost(account.id, {
      date: day.date,
      workoutKcal: day.workoutKcal,
      algorithm: ALGORITHM,
      meals,
    });

    expect(heavier.totals.energyKcal!).toBeGreaterThan(day.totals.energyKcal!);
    expect(heavier.warnings.length).toBeGreaterThan(0);
  });

  it('пересчёт выбрасывает позиции, которых в пуле нет', async () => {
    const plan = await planner.generate(account.id, request());
    const [day] = plan.days;

    const recost = await planner.recost(account.id, {
      date: day.date,
      workoutKcal: 0,
      algorithm: ALGORITHM,
      meals: [{ meal: 'breakfast', items: [{ key: 'product:нет-такого', amount: 100 }] }],
    });

    expect(recost.meals[0].items).toEqual([]);
    expect(recost.totals.energyKcal).toBe(0);
  });

  // ── планы и шаблоны ──────────────────────────────────────────────────────

  it('сохраняет, читает и удаляет план', async () => {
    const generated = await planner.generate(account.id, request());
    const saved = await planner.savePlan(account.id, { name: 'Неделя на пробу', plan: generated });

    expect(saved.name).toBe('Неделя на пробу');
    expect(saved.from).toBe('2026-08-17');
    expect((await planner.listPlans(account.id)).total).toBe(1);

    const read = await planner.plan(account.id, saved.id);
    expect(read.plan.days).toHaveLength(7);
    expect(read.plan.seed).toBe(42);

    await planner.removePlan(account.id, saved.id);
    expect((await planner.listPlans(account.id)).total).toBe(0);
    await expect(planner.plan(account.id, saved.id)).rejects.toThrow(/не найден/);
  });

  it('план без имени получает имя из периода', async () => {
    const saved = await planner.savePlan(account.id, {
      name: '   ',
      plan: await planner.generate(account.id, request()),
    });
    expect(saved.name).toBe('2026-08-17 — 2026-08-23');
  });

  it('метки приводятся к порядку и повторы схлопываются', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'С метками',
      tags: ['  Разгон ', 'разгон', 'ЛЕТО', 'лето', 'белок'],
      plan: await planner.generate(account.id, request()),
    });

    // нижний регистр, без повторов, по алфавиту: иначе один и тот же фильтр
    // давал бы разные наборы в зависимости от того, как метку набрали
    expect(saved.tags).toEqual(['белок', 'лето', 'разгон']);
  });

  it('отбирает планы по меткам и ищет по названию', async () => {
    const plan = await planner.generate(account.id, request());
    await planner.savePlan(account.id, { name: 'Разгон весной', tags: ['разгон'], plan });
    await planner.savePlan(account.id, { name: 'Спокойная неделя', tags: ['мягко', 'лето'], plan });
    await planner.savePlan(account.id, { name: 'Разгон летом', tags: ['разгон', 'лето'], plan });

    const byTag = await planner.listPlans(account.id, { tags: ['разгон'] });
    expect(byTag.total).toBe(2);

    // две метки — это «и», а не «или»
    const byBoth = await planner.listPlans(account.id, { tags: ['разгон', 'лето'] });
    expect(byBoth.items.map((item) => item.name)).toEqual(['Разгон летом']);

    // поиск без учёта регистра и по куску слова
    const bySearch = await planner.listPlans(account.id, { search: 'РАЗГОН' });
    expect(bySearch.total).toBe(2);
    expect(await planner.listPlans(account.id, { search: 'нет такого' })).toMatchObject({ total: 0 });
  });

  it('страницы режут список, а всего считает по фильтру', async () => {
    const plan = await planner.generate(account.id, request());
    for (let i = 1; i <= 5; i++) {
      await planner.savePlan(account.id, { name: `План ${i}`, tags: i % 2 === 0 ? ['чёт'] : [], plan });
    }

    const first = await planner.listPlans(account.id, { page: 1, pageSize: 2 });
    expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(first.items).toHaveLength(2);

    const last = await planner.listPlans(account.id, { page: 3, pageSize: 2 });
    expect(last.items).toHaveLength(1);
    // страница за концом списка пуста, но общее число не врёт
    expect(await planner.listPlans(account.id, { page: 9, pageSize: 2 })).toMatchObject({
      total: 5,
      items: [],
    });

    // «всего» считается после фильтра, иначе пагинация покажет несуществующие страницы
    expect(await planner.listPlans(account.id, { tags: ['чёт'], pageSize: 1 })).toMatchObject({
      total: 2,
    });
  });

  it('метки аккаунта приходят с числом планов', async () => {
    const plan = await planner.generate(account.id, request());
    await planner.savePlan(account.id, { name: 'Раз', tags: ['разгон', 'лето'], plan });
    await planner.savePlan(account.id, { name: 'Два', tags: ['разгон'], plan });

    expect(await planner.planTags(account.id)).toEqual([
      { tag: 'разгон', count: 2 },
      { tag: 'лето', count: 1 },
    ]);
  });

  it('план переименовывается и перемечается, не теряя дней', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'Как было',
      tags: ['старое'],
      plan: await planner.generate(account.id, request()),
    });

    const renamed = await planner.updatePlan(account.id, saved.id, { name: 'Как стало' });
    expect(renamed.name).toBe('Как стало');
    // метки не трогали — они на месте
    expect(renamed.tags).toEqual(['старое']);

    const retagged = await planner.updatePlan(account.id, saved.id, { tags: ['новое', 'новое'] });
    expect(retagged.tags).toEqual(['новое']);
    expect((await planner.plan(account.id, saved.id)).plan.days).toHaveLength(7);

    // пустое имя не стирает старое: у плана всегда есть, как его назвать
    const kept = await planner.updatePlan(account.id, saved.id, { name: '   ' });
    expect(kept.name).toBe('Как стало');
  });

  it('чужой план не читается, не правится и не удаляется', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'Мой',
      plan: await planner.generate(account.id, request()),
    });
    const stranger = '00000000-0000-4000-8000-000000000000';

    await expect(planner.plan(stranger, saved.id)).rejects.toThrow(/не найден/);
    await expect(planner.updatePlan(stranger, saved.id, { name: 'чужое' })).rejects.toThrow(/не найден/);
    await expect(planner.removePlan(stranger, saved.id)).rejects.toThrow(/не найден/);
  });

  it('метку можно переименовать во всех планах разом', async () => {
    const plan = await planner.generate(account.id, request());
    await planner.savePlan(account.id, { name: 'Раз', tags: ['разгон', 'лето'], plan });
    await planner.savePlan(account.id, { name: 'Два', tags: ['разгон'], plan });
    await planner.savePlan(account.id, { name: 'Три', tags: ['мягко'], plan });

    expect(await planner.renameTag(account.id, 'разгон', 'Ускорение')).toEqual({ changed: 2 });

    const tags = await planner.planTags(account.id);
    expect(tags.map((entry) => entry.tag)).toEqual(['ускорение', 'лето', 'мягко']);
    // не тронутый план остался с прежней меткой
    expect((await planner.listPlans(account.id, { tags: ['мягко'] })).total).toBe(1);
  });

  it('переименование в уже существующую метку не даёт повтора', async () => {
    const plan = await planner.generate(account.id, request());
    await planner.savePlan(account.id, { name: 'Оба', tags: ['разгон', 'лето'], plan });

    await planner.renameTag(account.id, 'разгон', 'лето');

    expect(await planner.planTags(account.id)).toEqual([{ tag: 'лето', count: 1 }]);
  });

  it('метку можно убрать, и планы при этом остаются', async () => {
    const plan = await planner.generate(account.id, request());
    await planner.savePlan(account.id, { name: 'Раз', tags: ['разгон', 'лето'], plan });
    await planner.savePlan(account.id, { name: 'Два', tags: ['разгон'], plan });

    expect(await planner.removeTag(account.id, 'разгон')).toEqual({ changed: 2 });

    expect(await planner.planTags(account.id)).toEqual([{ tag: 'лето', count: 1 }]);
    expect((await planner.listPlans(account.id)).total).toBe(2);
  });

  it('пустое имя метки отклоняется, а неизвестная метка ничего не трогает', async () => {
    const plan = await planner.generate(account.id, request());
    await planner.savePlan(account.id, { name: 'Раз', tags: ['лето'], plan });

    await expect(planner.renameTag(account.id, 'лето', '  ')).rejects.toThrow(/пустое/);
    expect(await planner.removeTag(account.id, 'нет-такой')).toEqual({ changed: 0 });
    expect(await planner.planTags(account.id)).toEqual([{ tag: 'лето', count: 1 }]);
  });

  // ── выгрузка плана в PDF ─────────────────────────────────────────────────

  it('собирает план в PDF со шрифтом, в котором есть кириллица', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'Неделя на пробу',
      tags: ['разгон'],
      plan: await planner.generate(account.id, request()),
    });
    const at = new Date('2026-08-16T09:00:00.000Z');
    const file = await buildPlanPdf({ plan: saved, locale: 'ru', generatedAt: at });

    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(file.subarray(-6).toString('latin1')).toContain('%%EOF');
    // системного шрифта с кириллицей в контейнере может не быть — свой встроен
    expect(file.toString('latin1')).toMatch(/FontFile2/);
    expect(file.length).toBeGreaterThan(10_000);
  });

  it('язык меняет содержимое файла, а не только подпись', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'Неделя',
      plan: await planner.generate(account.id, request()),
    });
    const at = new Date('2026-08-16T09:00:00.000Z');

    const [ru, en] = await Promise.all([
      buildPlanPdf({ plan: saved, locale: 'ru', generatedAt: at }),
      buildPlanPdf({ plan: saved, locale: 'en', generatedAt: at }),
    ]);

    expect(ru.equals(en)).toBe(false);
    // английский собрался целиком, а не оборвался на первой непереведённой строке
    expect(en.length).toBeGreaterThan(10_000);
  });

  it('два прогона на тех же данных дают одинаковый файл', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'Неделя',
      plan: await planner.generate(account.id, request()),
    });
    const at = new Date('2026-08-16T09:00:00.000Z');

    // время сборки передаётся снаружи ровно ради этого — как и в выгрузке (D-010)
    const [first, second] = await Promise.all([
      buildPlanPdf({ plan: saved, locale: 'ru', generatedAt: at }),
      buildPlanPdf({ plan: saved, locale: 'ru', generatedAt: at }),
    ]);
    expect(first.equals(second)).toBe(true);
  });

  it('не оставляет пустых страниц в конце', async () => {
    // подпись внизу печатается ниже нижнего поля, а запись за полем заставляет
    // pdfkit добавить страницу — в конце файла появлялся пустой лист
    const day = await planner.generate(account.id, request({ from: '2026-08-17', to: '2026-08-17' }));
    const saved = await planner.savePlan(account.id, { name: 'Один день', plan: day });
    const file = await buildPlanPdf({
      plan: saved,
      locale: 'ru',
      generatedAt: new Date('2026-08-16T09:00:00.000Z'),
    });

    expect(pageCount(file)).toBe(1);
  });

  it('длинный план разложен по страницам, и все они с содержимым', async () => {
    const saved = await planner.savePlan(account.id, {
      name: 'Неделя',
      plan: await planner.generate(account.id, request()),
    });
    const file = await buildPlanPdf({
      plan: saved,
      locale: 'ru',
      generatedAt: new Date('2026-08-16T09:00:00.000Z'),
    });

    const pages = pageCount(file);
    expect(pages).toBeGreaterThan(1);
    // у каждой страницы свой поток содержимого: пустая страница его не имеет
    expect(contentCount(file)).toBe(pages);
  });

  it('встроенные шаблоны приходят вместе со своими', async () => {
    const before = await planner.templates(account.id);
    expect(before.every((template) => template.builtin)).toBe(true);
    // у встроенных имя двуязычное, у своих — строка, введённая человеком
    expect(before.map((template) => (template.name as { ru: string }).ru)).toContain('Мягкий темп');
    // режим тренировок наборы не трогают: он выбирается отдельно (D-037)
    expect(before.every((template) => template.settings.training === undefined)).toBe(true);

    const own = await planner.saveTemplate(account.id, {
      name: 'Моя неделя',
      description: 'как обычно',
      settings: { from: '2026-08-17', to: '2026-08-23', training: { mode: 'who' }, seed: 7 },
    });

    // период и зерно в шаблон не идут: шаблон говорит «как», а не «когда»
    expect(own.settings).not.toHaveProperty('from');
    expect(own.settings).not.toHaveProperty('seed');
    expect(own.settings.training).toEqual({ mode: 'who' });

    const after = await planner.templates(account.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)!.name).toBe('Моя неделя');

    await planner.removeTemplate(account.id, own.id);
    expect(await planner.templates(account.id)).toHaveLength(before.length);
  });

  it('встроенный шаблон удалить нельзя', async () => {
    await expect(planner.removeTemplate(account.id, 'builtin:who')).rejects.toThrow(/Встроенный/);
  });
});

/** Сколько в файле страниц — по объявлениям объектов страниц, а не по виду. */
function pageCount(file: Buffer): number {
  return (file.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** Сколько страниц несут содержимое: у пустой страницы потока нет. */
function contentCount(file: Buffer): number {
  return (file.toString('latin1').match(/\/Contents\s+\d+\s+\d+\s+R/g) ?? []).length;
}

/** Расход и тренировки за год: нормам нужно, от чего считать. */
async function addHealth(em: EntityManager, account: Account): Promise<void> {
  const fork = em.fork();

  for (let i = 0; i < 30; i++) {
    const date = shift('2026-08-10', -i);
    fork.persist([
      fork.create(HealthDaily, {
        account,
        date,
        type: 'ActiveEnergyBurned',
        source: 'Часы',
        unit: null,
        samples: 1,
        sum: 700,
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
        sum: 1700,
        min: null,
        max: null,
        avg: null,
      }),
    ]);

    // тренировки трижды в неделю: ходьба, бег и силовая
    if (i % 7 === 0) {
      fork.persist(
        fork.create(HealthWorkout, {
          account,
          date,
          startedAt: `${date} 07:00:00`,
          endedAt: `${date} 08:00:00`,
          type: 'Walking',
          durationMin: 60,
          energyKcal: 150,
          distanceKm: 5,
          source: 'Часы',
        }),
      );
    }
    if (i % 7 === 2) {
      fork.persist(
        fork.create(HealthWorkout, {
          account,
          date,
          startedAt: `${date} 18:00:00`,
          endedAt: `${date} 18:40:00`,
          type: 'TraditionalStrengthTraining',
          durationMin: 40,
          energyKcal: 140,
          distanceKm: null,
          source: 'Часы',
        }),
      );
    }
    if (i % 7 === 4) {
      fork.persist(
        fork.create(HealthWorkout, {
          account,
          date,
          startedAt: `${date} 19:00:00`,
          endedAt: `${date} 19:35:00`,
          type: 'Running',
          durationMin: 35,
          energyKcal: 260,
          distanceKm: 6,
          source: 'Часы',
        }),
      );
    }
  }

  await fork.flush();
}

function shift(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
