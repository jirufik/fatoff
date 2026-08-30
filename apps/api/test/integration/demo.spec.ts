import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccountsService } from '../../src/modules/accounts/accounts.service';
import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import { Account, DaySnapshot, HealthDaily } from '../../src/database/entities';
import { DemoService } from '../../src/modules/demo/demo.service';
import { DEMO_DAYS, buildStory } from '../../src/modules/demo/demo-story';
import { JournalService } from '../../src/modules/journal/journal.service';
import { PlannerService } from '../../src/modules/planner/planner.service';
import { AccountFactsService } from '../../src/modules/planner/facts.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { createTestOrm, testConfig } from '../orm-test';

/**
 * Демо-аккаунт проверяется не по числу вставленных строк, а по тому, что видит
 * человек: раскрывается ли день, посчиталась ли оценка, есть ли из чего считать
 * нормы. Наполнение, на котором пустует хоть одна страница, бесполезно — ради
 * непустых страниц оно и заведено (D-068).
 */
describe('демо-аккаунт', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let demo: DemoService;
  let journal: JournalService;
  let facts: AccountFactsService;
  let planner: PlannerService;

  beforeAll(async () => {
    orm = await createTestOrm('demo');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();

    const cfg = testConfig({});
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    const yazio = new YazioService(cfg as unknown as AppConfigService, crypto, em);
    const accounts = new AccountsService(em, crypto, yazio);
    facts = new AccountFactsService(em);
    planner = new PlannerService(em, facts);
    demo = new DemoService(em, accounts, planner);
    journal = new JournalService(em, facts);
  });

  it('создаётся полугодовой историей, которую видно на странице дней', async () => {
    const account = await demo.generate('ru');

    expect(account.isDemo).toBe(true);
    // синхронизировать нечего: ни пароля, ни папки
    expect(account.syncEnabled).toBe(false);
    expect(account.storedDays).toBe(DEMO_DAYS);

    const page = await journal.days(account.id, { page: 1, pageSize: 40 });
    expect(page.total).toBe(DEMO_DAYS);

    const withFood = page.items.filter((day) => day.energyInKcal !== null && day.energyInKcal > 0);
    const withSteps = page.items.filter((day) => day.steps !== null && day.steps > 0);
    expect(withFood.length).toBeGreaterThan(page.items.length * 0.7);
    expect(withSteps.length).toBeGreaterThan(page.items.length * 0.9);

    // оценка дня складывается из шести составляющих, и ей есть на чём считаться
    const scored = page.items.filter((day) => day.score !== null);
    expect(scored.length).toBeGreaterThan(page.items.length * 0.7);
  });

  it('день раскрывается приёмами пищи с настоящими названиями', async () => {
    const account = await demo.generate('ru');
    const page = await journal.days(account.id, { page: 1, pageSize: 40 });
    const day = page.items.find((item) => item.entries > 3);
    expect(day).toBeDefined();

    const detail = await journal.day(account.id, day!.date);
    expect(detail.meals.length).toBeGreaterThan(2);

    const names = detail.meals.flatMap((meal) => meal.items.map((item) => item.name));
    expect(names.length).toBeGreaterThan(3);
    // «Unknown (id)» означает запись без карточки продукта: кэш не наполнили
    expect(names.some((name) => name.startsWith('Unknown'))).toBe(false);
    expect(names.some((name) => /[а-яё]/i.test(name))).toBe(true);
  });

  it('английское демо называет еду по-английски', async () => {
    const account = await demo.generate('en');
    const page = await journal.days(account.id, { page: 1, pageSize: 40 });
    const day = page.items.find((item) => item.entries > 3)!;

    const detail = await journal.day(account.id, day.date);
    const names = detail.meals.flatMap((meal) => meal.items.map((item) => item.name));
    expect(names.some((name) => /[а-яё]/i.test(name))).toBe(false);
  });

  it('нормы считаются: есть профиль, взвешивания и расход', async () => {
    const account = await demo.generate('ru');
    const known = await facts.collect(account.id);

    expect(known.sex).toBe('female');
    expect(known.heightCm).toBe(168);
    expect(known.weightKg).not.toBeNull();
    expect(known.bodyFatPct).not.toBeNull();
    expect(known.expenditure.basalKcal).toBeGreaterThan(1200);
    expect(known.expenditure.activeKcal).toBeGreaterThan(200);
    expect(known.expenditure.daysCovered).toBeGreaterThan(20);
    expect(known.intakeKcal).toBeGreaterThan(1000);
  });

  it('в планах лежит собранная неделя, а не пустота', async () => {
    const account = await demo.generate('ru');
    const saved = await planner.listPlans(account.id, { page: 1, pageSize: 10 });

    expect(saved.total).toBe(1);
    const plan = saved.items[0]!;
    expect(plan.name).toBe('Неделя в дефиците');
    expect(plan.tags).toContain('демо');
    // семь дней и меню в каждом: план, собранный из её же дневника
    expect(plan.plan.days.length).toBe(7);
    expect(plan.plan.days[0]!.meals.length).toBeGreaterThan(2);
  });

  it('вес снижается за полгода, но не по линейке', async () => {
    const story = buildStory('2026-08-30');
    const weights = story.days.filter((day) => day.weightKg !== null).map((day) => day.weightKg!);

    expect(weights[0]! - weights[weights.length - 1]!).toBeGreaterThan(3);
    // плато посреди истории: без него демо показывает не жизнь, а арифметику
    const middle = story.days.slice(60, 95).filter((day) => day.weightKg !== null);
    const drift = middle[0]!.weightKg! - middle[middle.length - 1]!.weightKg!;
    expect(Math.abs(drift)).toBeLessThan(0.9);
  });

  it('повторная генерация заменяет прежнее демо, а не добавляет второе', async () => {
    const first = await demo.generate('ru');
    const second = await demo.generate('ru');

    expect(second.id).not.toBe(first.id);
    expect(await em.fork().count(Account, { isDemo: true })).toBe(1);
    // и мусора от прежнего не остаётся: строки уходят вместе с аккаунтом
    const fresh = em.fork();
    expect(await fresh.count(DaySnapshot, { account: first.id })).toBe(0);
    expect(await fresh.count(HealthDaily, { account: first.id })).toBe(0);
  });

  it('история одинакова при каждой сборке: демо воспроизводимо', () => {
    const left = buildStory('2026-08-30');
    const right = buildStory('2026-08-30');
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });
});
