import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALGORITHM_SETTINGS,
  type MealComboDto,
  type MealKey,
  type PoolItemDto,
} from '@fatoff/contracts';

import { comboTotals } from './food-pool';
import {
  makeRng,
  pickCandidates,
  selectCombo,
  selectLightestCombo,
  selectMeal,
  sum,
  toPlannedMeal,
  type MealTarget,
} from './menu-generator';

const settings = DEFAULT_ALGORITHM_SETTINGS;

/** Маленький пул, где у каждого продукта своя роль: белок, крупа, жир, овощ. */
const item = (
  name: string,
  per: { energyKcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number },
  over: Partial<PoolItemDto> = {},
): PoolItemDto => ({
  key: `product:${name}`,
  kind: 'product',
  sourceId: name,
  name,
  producer: null,
  baseUnit: 'g',
  serving: null,
  servingAmount: null,
  meals: ['breakfast', 'lunch', 'dinner', 'snack'],
  entries: 10,
  lastUsed: '2026-08-01',
  typicalAmount: 100,
  minAmount: 50,
  maxAmount: 160,
  per,
  ...over,
});

const POOL: PoolItemDto[] = [
  item('курица', { energyKcal: 1.65, proteinG: 0.31, carbsG: 0, fatG: 0.036, fiberG: 0 }),
  item('творог', { energyKcal: 1.01, proteinG: 0.18, carbsG: 0.033, fatG: 0.02, fiberG: 0 }),
  item('гречка', { energyKcal: 1.1, proteinG: 0.043, carbsG: 0.216, fatG: 0.011, fiberG: 0.028 }),
  item('хлеб', { energyKcal: 2.65, proteinG: 0.09, carbsG: 0.49, fatG: 0.032, fiberG: 0.027 }),
  item('масло', { energyKcal: 8.84, proteinG: 0, carbsG: 0, fatG: 1, fiberG: 0 }, { typicalAmount: 10, minAmount: 5, maxAmount: 16 }),
  item('брокколи', { energyKcal: 0.34, proteinG: 0.028, carbsG: 0.07, fatG: 0.004, fiberG: 0.026 }),
  item('яблоко', { energyKcal: 0.52, proteinG: 0.003, carbsG: 0.138, fatG: 0.002, fiberG: 0.024 }),
];

const target = (over: Partial<MealTarget> = {}): MealTarget => ({
  meal: 'lunch' as MealKey,
  energyKcal: 500,
  proteinG: 30,
  carbsG: 55,
  fatG: 17,
  fiberG: 7,
  proteinFloorG: 21,
  ...over,
});

describe('подбор приёма пищи', () => {
  it('попадает в целевую калорийность с заданным допуском', () => {
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(1));
    const error = Math.abs(meal.totals.energy - 500) / 500;

    expect(error).toBeLessThanOrEqual(settings.energyTolerancePct / 100);
    expect(meal.shortfalls).toEqual([]);
  });

  it('не опускает белок ниже порога приёма', () => {
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(7));
    expect(meal.totals.protein).toBeGreaterThanOrEqual(21);
  });

  it('держит число позиций в заданных границах', () => {
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(3));
    expect(meal.items.length).toBeGreaterThanOrEqual(settings.minItemsPerMeal);
    expect(meal.items.length).toBeLessThanOrEqual(settings.maxItemsPerMeal);
  });

  it('одно зерно — один и тот же набор', () => {
    const first = selectMeal(target(), POOL, settings, new Map(), makeRng(42));
    const second = selectMeal(target(), POOL, settings, new Map(), makeRng(42));
    expect(second.items.map((i) => [i.item.key, i.amount])).toEqual(
      first.items.map((i) => [i.item.key, i.amount]),
    );
  });

  it('граммовки не выходят за границы привычной порции', () => {
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(11));
    for (const { item: chosen, amount } of meal.items) {
      expect(amount).toBeGreaterThanOrEqual(chosen.minAmount - settings.roundToG);
      expect(amount).toBeLessThanOrEqual(chosen.maxAmount + settings.roundToG);
    }
  });

  it('граммовка округляется к шагу, а не выдаёт 73.4 г', () => {
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(5));
    for (const { amount } of meal.items) {
      expect(amount % settings.roundToG).toBe(0);
    }
  });

  it('не берёт продукт из чужого приёма пищи', () => {
    const pool = POOL.map((entry) =>
      entry.name === 'хлеб' ? { ...entry, meals: ['breakfast' as MealKey] } : entry,
    );
    const meal = selectMeal(target({ meal: 'dinner' }), pool, settings, new Map(), makeRng(2));
    expect(meal.items.some((chosen) => chosen.item.name === 'хлеб')).toBe(false);
  });

  it('исчерпавший повторы продукт в набор не попадает', () => {
    const used = new Map(POOL.map((entry) => [entry.key, settings.maxRepeats]));
    used.delete('product:курица');
    used.delete('product:гречка');
    used.delete('product:брокколи');

    const meal = selectMeal(target(), POOL, settings, new Map(used), makeRng(4));
    expect(meal.items.length).toBeGreaterThan(0);
    for (const chosen of meal.items) {
      expect(['курица', 'гречка', 'брокколи']).toContain(chosen.item.name);
    }
  });

  it('когда подходящих продуктов нет, объясняет, а не выдаёт мусор', () => {
    const meal = selectMeal(target({ meal: 'snack' }), [], settings, new Map(), makeRng(1));
    expect(meal.items).toEqual([]);
    expect(meal.shortfalls[0].code).toBe('meal.no-candidates');
  });

  it('говорит, если в цель по калориям уложиться не вышло', () => {
    // из одного масла обед на 500 ккал с порогом белка не собрать
    const meal = selectMeal(target(), [POOL[4]], settings, new Map(), makeRng(1));
    expect(meal.shortfalls.map((item) => item.code)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^meal\.(off-energy|low-protein)$/)]),
    );
  });

  it('вес клетчатки двигает выбор в её сторону', () => {
    const plain = selectMeal(target(), POOL, settings, new Map(), makeRng(9));
    const fibrous = selectMeal(
      target(),
      POOL,
      { ...settings, weights: { ...settings.weights, fiber: 8 } },
      new Map(),
      makeRng(9),
    );
    expect(fibrous.totals.fiber).toBeGreaterThanOrEqual(plain.totals.fiber);
  });

  it('закреплённое блюдо остаётся в наборе, остальное добирается вокруг', () => {
    const pinned = [{ item: POOL[5], amount: 120 }]; // брокколи
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(8), pinned);

    expect(meal.items[0].item.name).toBe('брокколи');
    expect(meal.items[0].amount).toBe(120);
    expect(meal.locked).toBe(1);
    expect(meal.items.length).toBeGreaterThan(1);
    expect(meal.totals.protein).toBeGreaterThanOrEqual(21);
  });

  it('доводка не трогает закреплённое, даже если с ним хуже', () => {
    // масло в обед на 500 ккал — плохой выбор, но человек его закрепил
    const pinned = [{ item: POOL[4], amount: 16 }];
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(2), pinned);

    expect(meal.items[0].item.name).toBe('масло');
    expect(meal.items[0].amount).toBe(16);
  });

  it('закреплённых больше, чем позиций в приёме, — лишние отбрасываются', () => {
    const pinned = POOL.slice(0, 6).map((item) => ({ item, amount: item.typicalAmount }));
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(1), pinned);
    expect(meal.items).toHaveLength(settings.maxItemsPerMeal);
  });

  it('в наборе видно, что поставлено человеком, а что подобрано', () => {
    const goal = target();
    const planned = toPlannedMeal(
      selectMeal(goal, POOL, settings, new Map(), makeRng(8), [{ item: POOL[5], amount: 120 }]),
      goal,
    );
    expect(planned.items[0].pinned).toBe(true);
    expect(planned.items.slice(1).every((item) => item.pinned === false)).toBe(true);
  });

  it('итог приёма равен сумме позиций', () => {
    const meal = selectMeal(target(), POOL, settings, new Map(), makeRng(13));
    const totals = sum(meal.items);
    expect(totals.energy).toBeCloseTo(meal.totals.energy, 6);
    expect(totals.protein).toBeCloseTo(meal.totals.protein, 6);
  });

  it('наружу уезжает состав с граммовкой и КБЖУ каждой позиции', () => {
    const goal = target();
    const planned = toPlannedMeal(selectMeal(goal, POOL, settings, new Map(), makeRng(6)), goal);

    expect(planned.targetKcal).toBe(500);
    expect(planned.items.length).toBeGreaterThan(0);

    const fromItems = planned.items.reduce((total, item) => total + item.energyKcal, 0);
    expect(Math.abs(fromItems - (planned.totals.energyKcal ?? 0))).toBeLessThanOrEqual(planned.items.length);
  });
});

describe('из каких приёмов берётся еда', () => {
  const only = (meal: MealKey): PoolItemDto =>
    item(
      `блюдо-${meal}`,
      { energyKcal: 1.5, proteinG: 0.1, carbsG: 0.15, fatG: 0.03, fiberG: 0.02 },
      { key: `product:${meal}`, meals: [meal] },
    );

  /** Пул из трёх блюд: одно только завтрак, одно только обед, одно только ужин. */
  const three = [only('breakfast'), only('lunch'), only('dinner')];

  const candidates = (meal: MealKey): string[] =>
    pickCandidates(meal, three, settings, new Map(), makeRng(1))
      .map((candidate) => candidate.name)
      .sort();

  it('в завтрак идут только завтраки', () => {
    expect(candidates('breakfast')).toEqual(['блюдо-breakfast']);
  });

  it('обед и ужин берут еду друг у друга', () => {
    expect(candidates('lunch')).toEqual(['блюдо-dinner', 'блюдо-lunch']);
    expect(candidates('dinner')).toEqual(['блюдо-dinner', 'блюдо-lunch']);
  });

  it('перекус остаётся при своём', () => {
    expect(candidates('snack')).toEqual([]);
  });
});

describe('подбор комплектом', () => {
  const byKey = new Map(POOL.map((entry) => [entry.key, entry]));

  const combo = (meal: MealKey, parts: Array<[string, number]>, key = meal): MealComboDto => {
    const items = parts.map(([name, amount]) => ({ key: `product:${name}`, amount }));
    return {
      key: `${meal}:${key}`,
      meal,
      from: '2026-08-01',
      entries: 3,
      items,
      totals: comboTotals(items, byKey),
    };
  };

  // курица 150 + гречка 100 + брокколи 100 ≈ 392 ккал
  const dinner = combo('dinner', [['курица', 150], ['гречка', 100], ['брокколи', 100]]);
  const names = (selection: { items: Array<{ item: PoolItemDto }> }): string[] =>
    selection.items.map((chosen) => chosen.item.name).sort();

  it('берёт состав целиком, а не собирает свой', () => {
    const chosen = selectCombo(target(), [dinner], byKey, settings, new Map(), new Map());
    expect(chosen).not.toBeNull();
    expect(names(chosen!)).toEqual(['брокколи', 'гречка', 'курица']);
    expect(chosen!.combo?.from).toBe('2026-08-01');
  });

  it('завтрак из обедов и ужинов не собирается', () => {
    expect(
      selectCombo(target({ meal: 'breakfast' }), [dinner], byKey, settings, new Map(), new Map()),
    ).toBeNull();
  });

  it('обед берёт ужин, а ужин — обед', () => {
    const lunch = combo('lunch', [['курица', 150], ['хлеб', 60]]);
    expect(selectCombo(target({ meal: 'lunch' }), [dinner], byKey, settings, new Map(), new Map()))
      .not.toBeNull();
    expect(selectCombo(target({ meal: 'dinner' }), [lunch], byKey, settings, new Map(), new Map()))
      .not.toBeNull();
  });

  it('подгоняет комплект одним коэффициентом и не рвёт пропорции', () => {
    const chosen = selectCombo(target(), [dinner], byKey, settings, new Map(), new Map())!;
    const factors = chosen.items.map(
      (chosenItem, index) => chosenItem.amount / dinner.items[index].amount,
    );

    // состав тот же, а размер порции один на весь комплект
    expect(names(chosen)).toEqual(['брокколи', 'гречка', 'курица']);
    expect(Math.max(...factors) - Math.min(...factors)).toBeLessThan(0.1);
  });

  it('не растягивает комплект сверх привычной порции', () => {
    // цель втрое больше комплекта: дальше полутора порций растягивать нечестно
    const huge = target({ energyKcal: 1500, proteinG: 120, proteinFloorG: 120 });
    const chosen = selectCombo(huge, [dinner], byKey, settings, new Map(), new Map())!;

    expect(chosen.items.map((item) => item.amount)).toEqual([240, 160, 160]);
    // и говорит, что не сошлось, а не выдаёт это за попадание
    expect(chosen.shortfalls.length).toBeGreaterThan(0);
  });

  it('съеденный на неделе комплект уступает место другому', () => {
    const other = combo('dinner', [['курица', 140], ['гречка', 110], ['брокколи', 90]], 'второй');
    const used = new Map([[dinner.key, 1]]);
    const chosen = selectCombo(target(), [dinner, other], byKey, settings, new Map(), used)!;

    expect(chosen.combo?.key).toBe(other.key);
  });
});

describe('перекус', () => {
  const byKey = new Map(POOL.map((entry) => [entry.key, entry]));

  const snack = (name: string, parts: Array<[string, number]>): MealComboDto => {
    const items = parts.map(([item, amount]) => ({ key: `product:${item}`, amount }));
    return {
      key: `snack:${name}`,
      meal: 'snack',
      from: '2026-08-01',
      entries: 3,
      items,
      totals: comboTotals(items, byKey),
    };
  };

  const apple = snack('яблоко', [['яблоко', 150]]); // 78 ккал
  const curd = snack('творог', [['творог', 150]]); // 152 ккал
  const bread = snack('хлеб', [['хлеб', 60], ['масло', 10]]); // 247 ккал
  const all = [bread, curd, apple];

  it('берёт самый лёгкий из её перекусов', () => {
    const chosen = selectLightestCombo('snack', all, byKey, settings, new Map())!;
    expect(chosen.combo?.key).toBe(apple.key);
  });

  it('на другой день берёт следующий по лёгкости, а не тот же', () => {
    const chosen = selectLightestCombo('snack', all, byKey, settings, new Map([[apple.key, 1]]))!;
    expect(chosen.combo?.key).toBe(curd.key);
  });

  it('перекусами считает только перекусы', () => {
    expect(selectLightestCombo('snack', [], byKey, settings, new Map())).toBeNull();
  });
});
