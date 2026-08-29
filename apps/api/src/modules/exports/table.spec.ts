import { describe, expect, it } from 'vitest';

import { TableBuilder, join, num, scalar, str, toCsvField } from './table';

describe('ячейки', () => {
  it('округляет до двух знаков', () => {
    expect(num(307.4444)).toBe(307.44);
    expect(num(307.4456)).toBe(307.45);
  });

  it('не показывает лишний ноль у целого', () => {
    expect(num(100.0)).toBe(100);
    expect(String(num(100.0))).toBe('100');
  });

  it('сохраняет микрограммы, которые округление стёрло бы в ноль', () => {
    // селен: 0.0000046 г — при двух знаках это был бы ноль
    expect(num(0.0000046)).toBe(0.0000046);
    expect(num(0.00012345)).toBe(0.0001235);
  });

  it('отличает честный ноль от округлённого', () => {
    expect(num(0)).toBe(0);
    expect(num(0.001)).toBe(0.001);
  });

  it('превращает не-число в пустоту', () => {
    expect(num(Number.NaN)).toBeNull();
    expect(num(Number.POSITIVE_INFINITY)).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  it('не выпускает минус ноль', () => {
    expect(Object.is(num(-0), 0)).toBe(true);
    // а маленькое отрицательное — живое значение, его сохраняем
    expect(num(-0.0001)).toBe(-0.0001);
  });

  it('отличает отсутствие строки от пустой строки', () => {
    expect(str(null)).toBeNull();
    expect(str(undefined)).toBeNull();
    expect(str('')).toBe('');
  });

  it('склеивает список в одну ячейку', () => {
    expect(join(['tired', 'stressed'])).toBe('tired;stressed');
    expect(join([])).toBeNull();
    expect(join(null)).toBeNull();
  });

  it('сводит произвольный JSON к скаляру', () => {
    expect(scalar(true)).toBe(true);
    expect(scalar(3.14159)).toBe(3.14);
    expect(scalar(null)).toBeNull();
    expect(scalar({ a: 1 })).toBe('{"a":1}');
  });

  it('в CSV пустое значение и пустая строка выглядят одинаково', () => {
    expect(toCsvField(null)).toBe('');
    expect(toCsvField('')).toBe('');
    expect(toCsvField(false)).toBe('false');
    expect(toCsvField(12.5)).toBe('12.5');
  });
});

describe('построитель таблицы', () => {
  it('собирает таблицу с колонками и строками', () => {
    const builder = new TableBuilder('weight', ['date', 'weight_kg']);
    builder.push(['2026-08-01', 75]);
    const table = builder.finish();
    expect(table).toEqual({
      name: 'weight',
      columns: ['date', 'weight_kg'],
      rows: [['2026-08-01', 75]],
    });
  });

  it('не пропускает строку неправильной ширины', () => {
    const builder = new TableBuilder('weight', ['date', 'weight_kg']);
    expect(() => builder.push(['2026-08-01'])).toThrow(/ожидалось 2 ячеек/);
  });
});
