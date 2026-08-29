import { EXPORT_TABLES, nutrientByColumn } from '@fatoff/contracts';
import { describe, expect, it } from 'vitest';

import { APPLE, OIL, SOUP, emptyDay, makeSource } from '../../../test/support/source';
import { buildTables } from './build';

/**
 * Справочник полей должен описывать ровно то, что выгрузка действительно
 * строит. Без этой проверки он врёт при первой же правке таблицы — а врущая
 * документация хуже отсутствующей.
 */
const OPTIONS = {
  toolVersion: '0.1.0',
  apiVersion: 'v9',
  account: 'тест',
  generatedAt: '2026-08-11 10:00:00',
};

/** Составные записи вида `carbs_g / protein_g` описывают несколько колонок разом. */
const documentedColumns = (fields: Array<{ name: string }>): Set<string> =>
  new Set(fields.flatMap((field) => field.name.split('/').map((part) => part.trim())));

function buildEverything() {
  const source = makeSource({
    from: '2026-08-01',
    to: '2026-08-02',
    user: { registration_date: '2026-08-01 07:00:00', sex: 'male' } as never,
    settings: { has_water_tracker: true },
    dietaryPreferences: { restriction: null },
    subscriptions: [{ start: '2025-01-01', type: 'yearly' }],
    streak: { '2026-08-01': { daytimes: ['lunch'], origin_of_recovery: null } },
    fasting: [
      {
        key: '16:8',
        start: '2026-08-01 20:00:00',
        end: '2026-08-02 12:00:00',
        fasting_periods: [{ start: { day: 0, time: '20:00' }, end: { day: 1, time: '12:00' } }],
        patches: [{ period_index: 0, start: '2026-08-01 20:05:00', end: null }],
      },
    ],
    bodyValues: [
      { kind: 'weight', loggedAt: '2026-08-01 07:00:00', date: '2026-08-01', value: 75 },
      { kind: 'body_fat', loggedAt: '2026-08-01 07:00:00', date: '2026-08-01', value: 22 },
    ],
    dailyExercise: new Map([['2026-08-01', { steps: 8400, duration: 74, energy: 320 }]]),
    products: new Map([
      ['p-apple', APPLE as never],
      ['p-oil', OIL as never],
    ]),
    recipes: new Map([['r-soup', { recipe: SOUP as never, isUserRecipe: false }]]),
    health: {
      days: new Map([
        [
          '2026-08-01',
          {
            steps: 8400,
            activeKcal: 320,
            basalKcal: 1400,
            exerciseMin: 41,
            standHours: 11,
            distanceKm: 6.1,
            flights: 3,
            restingHr: 58,
            heartRateAvg: 72,
            hrvMs: 45,
            respiratoryRate: 14,
            oxygenSaturation: 0.97,
            weightKg: 74.5,
          },
        ],
      ]),
      workouts: [
        {
          date: '2026-08-01',
          startedAt: '2026-08-01 18:00:00',
          type: 'Walking',
          durationMin: 45,
          energyKcal: 180,
          distanceKm: 3.4,
          source: 'Apple Watch',
        },
      ],
      sleep: new Map([
        [
          '2026-08-01',
          {
            night: '2026-08-01',
            source: 'Apple Watch',
            inBedMin: 480,
            asleepMin: 420,
            deepMin: 90,
            remMin: 70,
            coreMin: 260,
            awakeMin: 15,
            fellAsleepAt: '2026-07-31 23:20:00',
            wokeAt: '2026-08-01 07:20:00',
          },
        ],
      ]),
    },
    days: new Map([
      [
        '2026-08-01',
        emptyDay({
          consumed: {
            products: [
              { id: 'e1', product_id: 'p-apple', date: '2026-08-01 08:00:00', daytime: 'breakfast', amount: 150 },
            ],
            recipe_portions: [
              { id: 'e2', recipe_id: 'r-soup', date: '2026-08-01 13:00:00', daytime: 'lunch', portion_count: 2 },
            ],
            simple_products: [],
          } as never,
          exercises: {
            activity: { steps: 8400, energy: 320, distance: 6100, duration: 74 },
            training: [{ id: 't1', name: 'Бег', energy: 410 }],
            custom_training: [],
          } as never,
          water: { water_intake: 1500 },
          goals: { 'energy.energy': 1900 },
          feeling: { note: 'Норм', tags: ['happy'] },
        }),
      ],
    ]),
  });

  return buildTables(source, OPTIONS);
}

describe('справочник полей', () => {
  const built = buildEverything();
  const byName = new Map(EXPORT_TABLES.map((doc) => [doc.name, doc]));

  it('описывает каждую таблицу, которую строит выгрузка', () => {
    const missing = built.tables.map((t) => t.name).filter((name) => !byName.has(name));
    expect(missing).toEqual([]);
  });

  it('не описывает таблиц, которых не существует', () => {
    const real = new Set(built.tables.map((t) => t.name));
    const phantom = EXPORT_TABLES.map((doc) => doc.name).filter((name) => !real.has(name));
    expect(phantom).toEqual([]);
  });

  it('описывает каждую колонку, кроме динамических колонок нутриентов', () => {
    const undocumented: string[] = [];

    for (const table of built.tables) {
      const doc = byName.get(table.name);
      if (!doc) continue;
      const documented = documentedColumns(doc.fields);

      for (const column of table.columns) {
        if (documented.has(column)) continue;
        // колонки нутриентов появляются по факту данных — их описывает реестр,
        // но только там, где таблица объявила динамические колонки
        if (doc.nutrients && nutrientByColumn(column)) continue;
        undocumented.push(`${table.name}.${column}`);
      }
    }

    expect(undocumented).toEqual([]);
  });

  it('помечает ровно те таблицы, куда нутриенты добавляются динамически', () => {
    for (const table of built.tables) {
      const doc = byName.get(table.name);
      if (!doc) continue;

      // имя колонки может совпасть с нутриентом, не будучи динамическим:
      // energy_kcal в таблице целей — это цель, и она описана поимённо
      const documented = documentedColumns(doc.fields);
      const dynamic = table.columns.filter(
        (column) => nutrientByColumn(column) && !documented.has(column),
      );

      expect({ table: table.name, dynamic: Boolean(doc.nutrients) }).toEqual({
        table: table.name,
        dynamic: dynamic.length > 0,
      });
    }
  });
});
