import { describe, expect, it } from 'vitest';

import { APPLE, OIL, SOUP, emptyDay, makeSource } from '../../../../test/support/source';
import type { BuildWarning } from '../source';
import type { Cell, Table } from '../table';
import {
  buildEntries,
  dailySummaryTable,
  mealSummaryTable,
  nutritionLogTable,
} from './diary';

const at = (table: Table, row: number, column: string): Cell =>
  table.rows[row][table.columns.indexOf(column)];

const consumedDay = (products: unknown[] = [], extra: Record<string, unknown> = {}) =>
  emptyDay({
    consumed: {
      products: products as never,
      recipe_portions: [],
      simple_products: [],
      ...extra,
    } as never,
  });

describe('записи дневника', () => {
  it('умножает нутриенты продукта на съеденное количество', () => {
    const source = makeSource({
      products: new Map([['p-apple', APPLE as never]]),
      days: new Map([
        [
          '2026-08-01',
          consumedDay([
            {
              id: 'e1',
              product_id: 'p-apple',
              date: '2026-08-01 08:00:00',
              daytime: 'breakfast',
              amount: 150,
              serving: 'piece',
              serving_quantity: 1,
            },
          ]),
        ],
      ]),
    });

    const entries = buildEntries(source, []);
    expect(entries).toHaveLength(1);
    // 0.52 ккал на грамм × 150 г
    expect(entries[0].nutrients.display('energy.energy')).toBeCloseTo(78, 6);
    expect(entries[0].name).toBe('Яблоко');
    expect(entries[0].kind).toBe('product');
  });

  it('умножает рецепт на число порций, а не на вес', () => {
    const source = makeSource({
      recipes: new Map([['r-soup', { recipe: SOUP as never, isUserRecipe: false }]]),
      days: new Map([
        [
          '2026-08-01',
          emptyDay({
            consumed: {
              products: [],
              simple_products: [],
              recipe_portions: [
                { id: 'e1', recipe_id: 'r-soup', date: '2026-08-01 13:00:00', daytime: 'lunch', portion_count: 2 },
              ],
            } as never,
          }),
        ],
      ]),
    });

    const entries = buildEntries(source, []);
    expect(entries[0].nutrients.display('energy.energy')).toBe(420); // 210 × 2
    expect(entries[0].serving).toBe('portion');
    expect(entries[0].amount).toBe(2);
  });

  it('не масштабирует быструю запись — её нутриенты уже итоговые', () => {
    const source = makeSource({
      days: new Map([
        [
          '2026-08-01',
          emptyDay({
            consumed: {
              products: [],
              recipe_portions: [],
              simple_products: [
                {
                  id: 'e1',
                  date: '2026-08-01 19:00:00',
                  daytime: 'dinner',
                  name: 'Ужин в гостях',
                  is_ai_generated: true,
                  nutrients: { 'energy.energy': 640 },
                },
              ],
            } as never,
          }),
        ],
      ]),
    });

    const entries = buildEntries(source, []);
    expect(entries[0].nutrients.display('energy.energy')).toBe(640);
    // количества у такой записи не существует, и ноль был бы выдумкой
    expect(entries[0].amount).toBeNull();
    expect(entries[0].aiGenerated).toBe(true);
  });

  it('сохраняет запись, даже если карточка продукта не выгрузилась', () => {
    const source = makeSource({
      days: new Map([
        [
          '2026-08-01',
          consumedDay([
            { id: 'e1', product_id: 'p-vanished', date: '2026-08-01 12:00:00', daytime: 'lunch', amount: 100 },
          ]),
        ],
      ]),
    });

    const entries = buildEntries(source, []);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Unknown (p-vanished)');
    expect(entries[0].nutrients.size).toBe(0);
  });

  it('сообщает о нутриентах, которых нет в реестре', () => {
    const warnings: BuildWarning[] = [];
    const source = makeSource({
      products: new Map([
        ['p-x', { ...APPLE, nutrients: { 'energy.energy': 1, 'nutrient.неведомый': 2 } } as never],
      ]),
    });

    buildEntries(source, warnings);
    expect(warnings[0].message).toMatch(/nutrient.неведомый/);
  });

  it('идёт по дням периода в порядке времени записи', () => {
    const day = (date: string, time: string, id: string) =>
      consumedDay([
        { id, product_id: 'p-apple', date: `${date} ${time}`, daytime: 'snack', amount: 10 },
      ]);

    const source = makeSource({
      products: new Map([['p-apple', APPLE as never]]),
      days: new Map([
        ['2026-08-02', day('2026-08-02', '09:00:00', 'e2')],
        ['2026-08-01', day('2026-08-01', '20:00:00', 'e1')],
      ]),
    });

    expect(buildEntries(source, []).map((e) => e.entryId)).toEqual(['e1', 'e2']);
  });

  it('не трогает дни за границами периода', () => {
    const source = makeSource({
      from: '2026-08-02',
      to: '2026-08-02',
      products: new Map([['p-apple', APPLE as never]]),
      days: new Map([
        [
          '2026-08-01',
          consumedDay([
            { id: 'e1', product_id: 'p-apple', date: '2026-08-01 08:00:00', daytime: 'breakfast', amount: 100 },
          ]),
        ],
      ]),
    });

    expect(buildEntries(source, [])).toHaveLength(0);
  });
});

describe('таблица nutrition_log', () => {
  const source = makeSource({
    products: new Map([
      ['p-apple', APPLE as never],
      ['p-oil', OIL as never],
    ]),
    days: new Map([
      [
        '2026-08-01',
        consumedDay([
          { id: 'e1', product_id: 'p-apple', date: '2026-08-01 08:00:00', daytime: 'breakfast', amount: 150, serving: 'piece', serving_quantity: 1 },
          { id: 'e2', product_id: 'p-oil', date: '2026-08-01 13:00:00', daytime: 'lunch', amount: 13, serving: 'tablespoon', serving_quantity: 1 },
        ]),
      ],
    ]),
  });

  it('выводит колонки только для встреченных нутриентов', () => {
    const table = nutritionLogTable(buildEntries(source, []));
    expect(table.columns.slice(0, 3)).toEqual(['date', 'logged_at', 'meal']);
    expect(table.columns).toContain('energy_kcal');
    expect(table.columns).toContain('potassium_mg');
    // ни один продукт не отслеживает витамин B12 — колонки быть не должно
    expect(table.columns).not.toContain('vitamin_b12_ug');
  });

  it('отличает неотслеживаемый нутриент от честного нуля', () => {
    const table = nutritionLogTable(buildEntries(source, []));
    // у масла углеводов действительно ноль, а калия оно не отслеживает
    expect(at(table, 1, 'carbs_g')).toBe(0);
    expect(at(table, 1, 'potassium_mg')).toBeNull();
  });

  it('переводит минералы в миллиграммы', () => {
    const table = nutritionLogTable(buildEntries(source, []));
    expect(at(table, 0, 'potassium_mg')).toBeCloseTo(160.5, 2);
  });
});

describe('таблица daily_summary', () => {
  const base = () =>
    makeSource({
      from: '2026-08-01',
      to: '2026-08-03',
      products: new Map([['p-apple', APPLE as never]]),
      dailyNutrients: new Map([
        ['2026-08-01', { energy: 78, carb: 20.7, protein: 0.4, fat: 0, energyGoal: 1900 }],
      ]),
      days: new Map([
        [
          '2026-08-01',
          consumedDay([
            { id: 'e1', product_id: 'p-apple', date: '2026-08-01 08:00:00', daytime: 'breakfast', amount: 150 },
          ]),
        ],
      ]),
    });

  it('даёт строку на каждый день периода, а не только на дни с едой', () => {
    const source = base();
    const table = dailySummaryTable(source, buildEntries(source, []));
    expect(table.rows.map((row) => row[0])).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('берёт макросы у YAZIO, а микронутриенты досчитывает', () => {
    const source = base();
    const table = dailySummaryTable(source, buildEntries(source, []));
    expect(at(table, 0, 'energy_kcal')).toBe(78);
    expect(at(table, 0, 'energy_goal_kcal')).toBe(1900);
    expect(at(table, 0, 'potassium_mg')).toBeCloseTo(160.5, 2);
  });

  it('день без данных даёт пустые ячейки, а не нули', () => {
    const source = base();
    const table = dailySummaryTable(source, buildEntries(source, []));
    expect(at(table, 1, 'energy_kcal')).toBeNull();
    expect(at(table, 1, 'steps')).toBeNull();
    expect(at(table, 1, 'water_ml')).toBeNull();
  });

  it('выгруженный день без активности даёт ноль, а не пустоту', () => {
    const source = base();
    source.days.set('2026-08-02', emptyDay({ exercises: { training: [], custom_training: [] }, water: { water_intake: 0 } }));
    const table = dailySummaryTable(source, buildEntries(source, []));
    expect(at(table, 1, 'steps')).toBe(0);
    expect(at(table, 1, 'water_ml')).toBe(0);
  });

  it('предпочитает диапазонные шаги дневным', () => {
    const source = base();
    source.dailyExercise.set('2026-08-01', { steps: 8400, duration: 74, energy: 320 });
    source.days.set(
      '2026-08-01',
      emptyDay({
        ...source.days.get('2026-08-01')!,
        exercises: { activity: { steps: 10, energy: 5 }, training: [], custom_training: [] },
      }),
    );
    const table = dailySummaryTable(source, buildEntries(source, []));
    expect(at(table, 0, 'steps')).toBe(8400);
    expect(at(table, 0, 'activity_energy_kcal')).toBe(320);
  });
});

describe('таблица meal_summary', () => {
  it('группирует по дню и приёму пищи и считает записи', () => {
    const source = makeSource({
      products: new Map([['p-apple', APPLE as never]]),
      days: new Map([
        [
          '2026-08-01',
          consumedDay([
            // разорванный обед: две записи в один приём пищи — законная ситуация
            { id: 'e1', product_id: 'p-apple', date: '2026-08-01 12:00:00', daytime: 'lunch', amount: 100 },
            { id: 'e2', product_id: 'p-apple', date: '2026-08-01 12:30:00', daytime: 'lunch', amount: 50 },
            { id: 'e3', product_id: 'p-apple', date: '2026-08-01 19:00:00', daytime: 'dinner', amount: 200 },
          ]),
        ],
      ]),
    });

    const table = mealSummaryTable(buildEntries(source, []));
    expect(table.rows).toHaveLength(2);
    expect(at(table, 0, 'meal')).toBe('dinner');
    expect(at(table, 1, 'meal')).toBe('lunch');
    expect(at(table, 1, 'entry_count')).toBe(2);
    expect(at(table, 1, 'energy_kcal')).toBeCloseTo(78, 6); // 150 г яблока
  });
});
