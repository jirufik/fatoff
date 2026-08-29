import { describe, expect, it } from 'vitest';

import { APPLE, OIL, emptyDay, makeSource } from '../../../test/support/source';
import { buildTables } from './build';
import type { ExportSource } from './source';

const OPTIONS = {
  toolVersion: '0.1.0',
  apiVersion: 'v9',
  account: 'основной',
  generatedAt: '2026-08-11 10:00:00',
};

const dayWith = (date: string, amount: number) =>
  emptyDay({
    consumed: {
      products: [
        { id: `e-${date}`, product_id: 'p-apple', date: `${date} 08:00:00`, daytime: 'breakfast', amount },
      ],
      recipe_portions: [],
      simple_products: [],
    } as never,
    water: { water_intake: 1500 },
    goals: { 'energy.energy': 1900 },
  });

function richSource(over: Partial<ExportSource> = {}): ExportSource {
  return makeSource({
    from: '2026-08-01',
    to: '2026-08-03',
    products: new Map([
      ['p-apple', APPLE as never],
      ['p-oil', OIL as never],
    ]),
    days: new Map([
      ['2026-08-01', dayWith('2026-08-01', 150)],
      ['2026-08-02', dayWith('2026-08-02', 200)],
    ]),
    dailyNutrients: new Map([
      ['2026-08-01', { energy: 78, carb: 20.7, protein: 0.4, fat: 0, energyGoal: 1900 }],
      ['2026-08-02', { energy: 104, carb: 27.6, protein: 0.5, fat: 0, energyGoal: 1900 }],
    ]),
    bodyValues: [{ kind: 'weight', loggedAt: '2026-08-01 07:00:00', date: '2026-08-01', value: 75 }],
    user: { registration_date: '2026-08-01 07:00:00', sex: 'male', body_height: 182 } as never,
    settings: { has_water_tracker: true },
    ...over,
  });
}

describe('сборка выгрузки', () => {
  it('ставит опись перед данными, а замечания в конец', () => {
    const { tables } = buildTables(richSource(), OPTIONS);
    expect(tables[0].name).toBe('meta');
    expect(tables[1].name).toBe('tables');
    expect(tables.at(-1)!.name).toBe('warnings');
  });

  it('опись перечисляет таблицы данных с числом строк и колонками', () => {
    const { tables } = buildTables(richSource(), OPTIONS);
    const index = tables[1];
    const names = index.rows.map((row) => row[0]);
    expect(names).toContain('nutrition_log');
    expect(names).toContain('products');
    // сама опись и meta в неё не входят — иначе она описывала бы себя
    expect(names).not.toContain('tables');
    expect(names).not.toContain('meta');

    const log = index.rows.find((row) => row[0] === 'nutrition_log')!;
    expect(log[1]).toBe(2);
    expect(String(log[2])).toContain('date;logged_at;meal');
  });

  it('в meta попадают счётчики и версии', () => {
    const { tables, meta } = buildTables(richSource(), OPTIONS);
    expect(meta.entries).toBe(2);
    expect(meta.products).toBe(2);
    expect(meta.days).toBe(2);
    expect(tables[0].rows[0]).toContain('v9');
    expect(tables[0].rows[0]).toContain('основной');
  });

  it('при обезличивании метка аккаунта не попадает в файл', () => {
    const { meta } = buildTables(richSource({ redact: true }), OPTIONS);
    expect(meta.account).toBeNull();
  });

  it('выбор датасетов убирает лишние таблицы', () => {
    const { tables } = buildTables(
      richSource({ datasets: new Set(['weight', 'account']) }),
      OPTIONS,
    );
    const names = tables.map((table) => table.name);
    expect(names).toEqual(['meta', 'tables', 'weight', 'profile', 'settings', 'subscriptions', 'warnings']);
  });

  it('сообщает о дне, про который YAZIO знает, а дневника нет', () => {
    const source = richSource();
    source.dailyNutrients.set('2026-08-03', { energy: 1500, carb: 0, protein: 0, fat: 0, energyGoal: 1900 });

    const { warnings } = buildTables(source, OPTIONS);
    const gap = warnings.find((warning) => warning.phase === 'Полнота');
    expect(gap?.message).toMatch(/2026-08-03/);
    expect(gap?.message).toMatch(/Запустите синхронизацию/);
  });

  it('две сборки на тех же данных дают одинаковый результат', () => {
    const first = buildTables(richSource(), OPTIONS);
    const second = buildTables(richSource(), OPTIONS);
    expect(JSON.stringify(second.tables)).toBe(JSON.stringify(first.tables));
  });

  it('расхождение с итогами YAZIO попадает и в замечания, и в счётчик meta', () => {
    const source = richSource();
    source.dailyNutrients.set('2026-08-01', { energy: 900, carb: 0, protein: 0, fat: 0, energyGoal: 1900 });

    const { warnings, meta, tables } = buildTables(source, OPTIONS);
    expect(warnings.some((warning) => warning.phase === 'Сверка')).toBe(true);
    expect(meta.warnings).toBe(warnings.length);
    expect(tables.at(-1)!.rows.length).toBe(warnings.length);
  });
});
