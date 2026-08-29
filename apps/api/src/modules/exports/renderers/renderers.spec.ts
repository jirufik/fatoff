import { describe, expect, it } from 'vitest';

import type { Table } from '../table';
import { renderCsv } from './csv';
import { renderJson, tableToJson } from './json';
import { formatCell, renderToon, renderToonTable } from './toon';

const table: Table = {
  name: 'nutrition_log',
  columns: ['date', 'product', 'amount', 'note', 'ai_generated'],
  rows: [
    ['2026-08-01', 'Яблоко', 150, null, false],
    ['2026-08-02', 'Хлеб "Бородинский", 1 шт.', 90, '', true],
  ],
};

describe('CSV', () => {
  it('пишет заголовок и строки', () => {
    const csv = renderCsv(table);
    expect(csv.split('\n')[0]).toBe('date,product,amount,note,ai_generated');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('экранирует запятые и кавычки', () => {
    const line = renderCsv(table).split('\n')[2];
    expect(line).toContain('"Хлеб ""Бородинский"", 1 шт."');
  });

  it('пустое значение и пустая строка выглядят одинаково — в CSV иначе нельзя', () => {
    const rows = renderCsv(table).split('\n');
    expect(rows[1].endsWith(',,false')).toBe(true);
    expect(rows[2]).toContain(',,true');
  });

  it('не портит перевод строки внутри ячейки', () => {
    const csv = renderCsv({ name: 't', columns: ['note'], rows: [['две\nстроки']] });
    expect(csv).toBe('note\n"две\nстроки"\n');
  });
});

describe('JSON', () => {
  it('сохраняет порядок колонок', () => {
    expect(Object.keys(tableToJson(table)[0])).toEqual(table.columns);
  });

  it('оставляет пустое значение пустым, а пустую строку — строкой', () => {
    const rows = tableToJson(table);
    expect(rows[0].note).toBeNull();
    expect(rows[1].note).toBe('');
  });

  it('собирает все таблицы в один документ по именам', () => {
    const bundle = JSON.parse(renderJson([table, { name: 'weight', columns: ['kg'], rows: [] }]));
    expect(Object.keys(bundle)).toEqual(['nutrition_log', 'weight']);
    expect(bundle.weight).toEqual([]);
  });
});

describe('TOON', () => {
  it('пишет имена колонок один раз — ради этого формат и нужен', () => {
    const toon = renderToonTable(table);
    const lines = toon.split('\n');
    expect(lines[0]).toBe('nutrition_log[2]{date,product,amount,note,ai_generated}:');
    expect(lines[1]).toBe('  2026-08-01,Яблоко,150,null,false');
  });

  it('берёт в кавычки то, что иначе прочтут неправильно', () => {
    expect(formatCell('простая строка')).toBe('простая строка');
    expect(formatCell('с, запятой')).toBe('"с, запятой"');
    expect(formatCell('с "кавычкой"')).toBe('"с \\"кавычкой\\""');
    expect(formatCell('16:8')).toBe('"16:8"');
    expect(formatCell('')).toBe('""');
    expect(formatCell(' пробел слева')).toBe('" пробел слева"');
    expect(formatCell('null')).toBe('"null"');
    expect(formatCell('true')).toBe('"true"');
    // строка, похожая на число, обязана быть в кавычках — иначе станет числом
    expect(formatCell('42')).toBe('"42"');
    expect(formatCell('-1.5e3')).toBe('"-1.5e3"');
  });

  it('числа пишет канонически, без хвостовых нулей и минус нуля', () => {
    expect(formatCell(150)).toBe('150');
    expect(formatCell(307.44)).toBe('307.44');
    expect(formatCell(-0)).toBe('0');
    expect(formatCell(0.0000046)).toBe('0.0000046');
  });

  it('экранирует перевод строки, а не рвёт строку таблицы', () => {
    expect(formatCell('две\nстроки')).toBe('"две\\nстроки"');
  });

  it('пустую таблицу пишет явной пустотой', () => {
    expect(renderToonTable({ name: 'weight', columns: ['kg'], rows: [] })).toBe('weight: []');
  });

  it('складывает документ из нескольких таблиц', () => {
    const toon = renderToon([table, { name: 'weight', columns: ['kg'], rows: [[75]] }]);
    expect(toon).toContain('weight[1]{kg}:');
    expect(toon.endsWith('\n')).toBe(true);
  });
});
