import { describe, expect, it } from 'vitest';

import { APPLE, OIL, SOUP, emptyDay, makeSource } from '../../../../test/support/source';
import type { Cell, Table } from '../table';
import { fastingTables, profileTable, settingsTable, subscriptionsTable } from './account';
import { bodyValuesTable, weightTable } from './body';
import { productTables, recipeTables } from './catalogue';
import { activityTables, dailyGoalsTable, feelingsTable, streakTable } from './day';

const at = (table: Table, row: number, column: string): Cell =>
  table.rows[row][table.columns.indexOf(column)];

describe('цели дня', () => {
  it('выводит оба варианта и раскладывает ключи через точку по колонкам', () => {
    const source = makeSource({
      days: new Map([
        [
          '2026-08-01',
          emptyDay({
            goals: { 'energy.energy': 1850, 'nutrient.carb': 220, 'activity.step': 10000, water: 2000, 'bodyvalue.weight': 69 },
            goalsUnmodified: { 'energy.energy': 1900 },
          }),
        ],
      ]),
    });

    const table = dailyGoalsTable(source);
    expect(table.rows).toHaveLength(2);
    expect(at(table, 0, 'variant')).toBe('effective');
    expect(at(table, 0, 'energy_kcal')).toBe(1850);
    expect(at(table, 0, 'steps')).toBe(10000);
    expect(at(table, 0, 'water_ml')).toBe(2000);
    expect(at(table, 0, 'weight_kg')).toBe(69);
    expect(at(table, 1, 'variant')).toBe('unmodified');
    expect(at(table, 1, 'carbs_g')).toBeNull();
  });

  it('пропускает день без целей', () => {
    const source = makeSource({ days: new Map([['2026-08-01', emptyDay({ goals: {} })]]) });
    expect(dailyGoalsTable(source).rows).toHaveLength(0);
  });
});

describe('активность', () => {
  const source = makeSource({
    dailyExercise: new Map([['2026-08-01', { steps: 8400, duration: 74, energy: 320 }]]),
    days: new Map([
      [
        '2026-08-01',
        emptyDay({
          exercises: {
            activity: { steps: 10, energy: 5, distance: 6100, duration: 3, source: 'health_kit', gateway: 'apple' },
            training: [{ id: 't1', name: 'Бег', energy: 410, duration: 35, distance: 5200, steps: 5400 }],
            custom_training: [{ id: 't2', name: 'Своя тренировка', energy: 100 }],
          },
        }),
      ],
    ]),
  });

  it('берёт шаги из диапазонного ответа, а дистанцию — из дневного', () => {
    const { daily } = activityTables(source);
    expect(at(daily, 0, 'steps')).toBe(8400);
    expect(at(daily, 0, 'distance_m')).toBe(6100);
    expect(at(daily, 0, 'source')).toBe('health_kit');
  });

  it('различает обычные и собственные тренировки', () => {
    const { workouts } = activityTables(source);
    expect(workouts.rows.map((r) => r[1])).toEqual(['training', 'custom_training']);
    expect(at(workouts, 0, 'energy_kcal')).toBe(410);
  });

  it('пропускает день, о котором ничего не известно', () => {
    const { daily } = activityTables(makeSource());
    expect(daily.rows).toHaveLength(0);
  });
});

describe('самочувствие и серия', () => {
  it('пропускает пустую запись самочувствия', () => {
    const source = makeSource({
      days: new Map([
        ['2026-08-01', emptyDay({ feeling: { note: null, tags: [] } })],
        ['2026-08-02', emptyDay({ feeling: { note: 'Тяжёлый день', tags: ['tired', 'stressed'] } })],
      ]),
    });

    const table = feelingsTable(source);
    expect(table.rows).toHaveLength(1);
    expect(at(table, 0, 'note')).toBe('Тяжёлый день');
    expect(at(table, 0, 'tags')).toBe('tired;stressed');
  });

  it('обрезает календарь серии по периоду', () => {
    const source = makeSource({
      from: '2026-08-02',
      to: '2026-08-02',
      streak: {
        '2026-08-01': { daytimes: ['breakfast'], origin_of_recovery: null },
        '2026-08-02': { daytimes: ['lunch', 'dinner'], origin_of_recovery: 'freeze' },
      },
    });

    const table = streakTable(source);
    expect(table.rows).toHaveLength(1);
    expect(at(table, 0, 'daytimes')).toBe('lunch;dinner');
    expect(at(table, 0, 'origin_of_recovery')).toBe('freeze');
  });
});

describe('вес и замеры', () => {
  const source = makeSource({
    bodyValues: [
      { kind: 'weight', loggedAt: '2026-08-05 07:10:00', date: '2026-08-05', value: 74.4 },
      { kind: 'weight', loggedAt: '2026-08-01 07:05:00', date: '2026-08-01', value: 75 },
      { kind: 'body_fat', loggedAt: '2026-08-01 07:05:00', date: '2026-08-01', value: 22.5 },
    ],
  });

  it('вес идёт своей таблицей и по возрастанию времени', () => {
    const table = weightTable(source);
    expect(table.rows.map((r) => r[0])).toEqual(['2026-08-01', '2026-08-05']);
    expect(at(table, 0, 'weight_kg')).toBe(75);
    // дата отделена от отметки времени — по ней таблица соединяется с остальными
    expect(at(table, 0, 'logged_at')).toBe('2026-08-01 07:05:00');
  });

  it('прочие замеры идут отдельно и не смешиваются с весом', () => {
    const table = bodyValuesTable(source);
    expect(table.rows).toHaveLength(1);
    expect(at(table, 0, 'type')).toBe('body_fat');
  });
});

describe('каталог продуктов и рецептов', () => {
  const source = makeSource({
    products: new Map([
      ['p-oil', OIL as never],
      ['p-apple', APPLE as never],
    ]),
    recipes: new Map([['r-soup', { recipe: SOUP as never, isUserRecipe: false }]]),
  });

  it('сортирует продукты, чтобы повторная сборка давала тот же файл', () => {
    const { products } = productTables(source);
    expect(products.rows.map((r) => r[0])).toEqual(['p-apple', 'p-oil']);
  });

  it('оставляет нутриенты продукта на базовую единицу', () => {
    const { products } = productTables(source);
    // оливковое масло: 8.84 ккал на миллилитр, а не на сто
    expect(at(products, 1, 'energy_kcal')).toBe(8.84);
    expect(at(products, 1, 'is_private')).toBe(true);
  });

  it('склеивает списки штрихкодов и стран в одну ячейку', () => {
    const { products } = productTables(source);
    expect(at(products, 0, 'countries')).toBe('fi');
    expect(at(products, 0, 'eans')).toBeNull();
  });

  it('раскладывает порции продукта отдельной таблицей', () => {
    const { servings } = productTables(source);
    expect(servings.rows).toHaveLength(2);
    expect(servings.columns).toEqual(['product_id', 'serving', 'amount']);
  });

  it('разворачивает рецепт в три таблицы', () => {
    const { recipes, ingredients, instructions } = recipeTables(source);
    expect(at(recipes, 0, 'portion_count')).toBe(4);
    expect(at(recipes, 0, 'ingredient_count')).toBe(1);
    expect(at(recipes, 0, 'energy_kcal')).toBe(210); // на порцию
    expect(at(recipes, 0, 'is_user_recipe')).toBe(false);
    expect(ingredients.rows).toHaveLength(1);
    expect(at(ingredients, 0, 'position')).toBe(1);
    expect(instructions.rows.map((r) => r[1])).toEqual([1, 2]);
    expect(at(instructions, 0, 'text')).toBe('Нарезать');
  });
});

describe('аккаунт', () => {
  const user = {
    registration_date: '2026-08-01 07:00:00',
    uuid: 'u-1',
    email: 'user@example.com',
    first_name: 'Тест',
    sex: 'male',
    date_of_birth: '1984-01-12',
    body_height: 182,
    city: 'Хельсинки',
    country: 'FI',
    is_premium: false,
    diet: { name: 'default', carb_percentage: 50, fat_percentage: 30, protein_percentage: 20 },
    tags: ['a', 'b'],
  };

  it('обезличивание гасит опознающие поля и оставляет телесные', () => {
    const table = profileTable(makeSource({ user: user as never, redact: true }));
    expect(at(table, 0, 'email')).toBeNull();
    expect(at(table, 0, 'uuid')).toBeNull();
    expect(at(table, 0, 'date_of_birth')).toBeNull();
    expect(at(table, 0, 'city')).toBeNull();
    // а это нужно для анализа и человека не опознаёт
    expect(at(table, 0, 'body_height_cm')).toBe(182);
    expect(at(table, 0, 'sex')).toBe('male');
    expect(at(table, 0, 'country')).toBe('FI');
  });

  it('без обезличивания профиль выгружается целиком', () => {
    const table = profileTable(makeSource({ user: user as never }));
    expect(at(table, 0, 'email')).toBe('user@example.com');
    expect(at(table, 0, 'diet_carb_percentage')).toBe(50);
    expect(at(table, 0, 'tags')).toBe('a;b');
  });

  it('без профиля таблица пуста, но колонки на месте', () => {
    const table = profileTable(makeSource());
    expect(table.rows).toHaveLength(0);
    expect(table.columns).toContain('body_height_cm');
  });

  it('настройки идут строка на тумблер', () => {
    const table = settingsTable(
      makeSource({
        settings: { has_water_tracker: true, weight_reminder_frequency: null, 'a.b': 3 },
        dietaryPreferences: { restriction: 'vegetarian' },
      }),
    );

    expect(table.columns).toEqual(['setting', 'value']);
    expect(table.rows).toEqual([
      ['a_b', 3],
      ['has_water_tracker', true],
      ['weight_reminder_frequency', null],
      ['dietary_restriction', 'vegetarian'],
    ]);
  });

  it('подписки выгружаются как есть', () => {
    const table = subscriptionsTable(
      makeSource({ subscriptions: [{ start: '2025-01-01', end: null, type: 'yearly', status: 'active' }] }),
    );
    expect(at(table, 0, 'type')).toBe('yearly');
    expect(at(table, 0, 'end')).toBeNull();
  });

  it('голодания разворачиваются в три таблицы по номеру сеанса', () => {
    const { history, periods, patches } = fastingTables(
      makeSource({
        fasting: [
          {
            key: '16:8',
            start: '2026-08-01 20:00:00',
            end: '2026-08-02 12:00:00',
            fasting_periods: [{ start: { day: 0, time: '20:00' }, end: { day: 1, time: '12:00' } }],
            patches: [{ period_index: 0, start: '2026-08-01 20:05:00', end: null }],
          },
        ],
      }),
    );

    expect(at(history, 0, 'session')).toBe(1);
    expect(at(history, 0, 'key')).toBe('16:8');
    expect(at(periods, 0, 'start_time')).toBe('20:00');
    expect(at(periods, 0, 'end_day')).toBe(1);
    expect(at(patches, 0, 'session')).toBe(1);
  });
});
