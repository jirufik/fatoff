import { describe, expect, it } from 'vitest';

import { APPLE, emptyDay, makeSource } from '../../../test/support/source';
import { reconcile } from './reconcile';
import type { BuildWarning } from './source';
import { buildEntries } from './tables/diary';

/** День с 150 г яблока — 78 ккал по нашей арифметике. */
const dayWithApple = (date: string) =>
  emptyDay({
    consumed: {
      products: [
        { id: 'e1', product_id: 'p-apple', date: `${date} 08:00:00`, daytime: 'breakfast', amount: 150 },
      ],
      recipe_portions: [],
      simple_products: [],
    } as never,
  });

const sourceWith = (totalsByDate: Record<string, number>, dates = Object.keys(totalsByDate)) =>
  makeSource({
    from: '2026-08-01',
    to: '2026-08-31',
    products: new Map([['p-apple', APPLE as never]]),
    days: new Map(dates.map((date) => [date, dayWithApple(date)])),
    dailyNutrients: new Map(
      Object.entries(totalsByDate).map(([date, energy]) => [
        date,
        { energy, carb: 0, protein: 0, fat: 0, energyGoal: 1900 },
      ]),
    ),
  });

describe('сверка с итогами YAZIO', () => {
  it('молчит, когда всё сходится', () => {
    const warnings: BuildWarning[] = [];
    const source = sourceWith({ '2026-08-01': 78 });
    reconcile(source, buildEntries(source, []), warnings);
    expect(warnings).toHaveLength(0);
  });

  it('терпит расхождение внутри полупроцента', () => {
    const warnings: BuildWarning[] = [];
    const source = sourceWith({ '2026-08-01': 78.3 });
    reconcile(source, buildEntries(source, []), warnings);
    expect(warnings).toHaveLength(0);
  });

  it('замечает расхождение сверх порога', () => {
    const warnings: BuildWarning[] = [];
    const source = sourceWith({ '2026-08-01': 378 });
    reconcile(source, buildEntries(source, []), warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].key).toBe('2026-08-01');
    expect(warnings[0].message).toMatch(/78\.0 ккал против 378\.0/);
  });

  it('на малых числах работает минимальный допуск в килокалорию', () => {
    // полпроцента от 2 ккал — сотые доли, и любой день ушёл бы в предупреждения
    const warnings: BuildWarning[] = [];
    const source = makeSource({
      from: '2026-08-01',
      to: '2026-08-01',
      days: new Map([['2026-08-01', dayWithApple('2026-08-01')]]),
      products: new Map(),
      dailyNutrients: new Map([['2026-08-01', { energy: 0.5, carb: 0, protein: 0, fat: 0, energyGoal: 0 }]]),
    });
    reconcile(source, buildEntries(source, []), warnings);
    expect(warnings).toHaveLength(0);
  });

  it('не сверяет день, который не выгружали', () => {
    const warnings: BuildWarning[] = [];
    const source = sourceWith({ '2026-08-01': 78, '2026-08-02': 2000 }, ['2026-08-01']);
    reconcile(source, buildEntries(source, []), warnings);
    expect(warnings).toHaveLength(0);
  });

  it('перечисляет первые десять дней и сворачивает остальные', () => {
    const totals: Record<string, number> = {};
    for (let day = 1; day <= 15; day++) {
      totals[`2026-08-${String(day).padStart(2, '0')}`] = 900;
    }

    const warnings: BuildWarning[] = [];
    const source = sourceWith(totals);
    reconcile(source, buildEntries(source, []), warnings);

    expect(warnings.filter((w) => w.key !== null)).toHaveLength(10);
    expect(warnings.at(-1)!.message).toMatch(/дней с расхождением: 15/);
  });

  it('не смотрит за границы периода', () => {
    const warnings: BuildWarning[] = [];
    const source = sourceWith({ '2026-09-01': 2000 }, ['2026-09-01']);
    reconcile(source, buildEntries(source, []), warnings);
    expect(warnings).toHaveLength(0);
  });
});
