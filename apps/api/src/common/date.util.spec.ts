import { describe, expect, it } from 'vitest';

import { addDays, dateRange, dayOf, daysBetween, isIsoDate, monthStart, today, weekStart } from './date.util';

describe('даты', () => {
  it('принимает только настоящие даты', () => {
    expect(isIsoDate('2026-08-28')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false); // 2026 не високосный
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('28.08.2026')).toBe(false);
  });

  it('сдвигает дату через границу месяца и года', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('строит период включительно', () => {
    expect(dateRange('2026-08-28', '2026-08-30')).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
    expect(dateRange('2026-08-28', '2026-08-28')).toEqual(['2026-08-28']);
  });

  it('отказывается строить период задом наперёд', () => {
    expect(() => dateRange('2026-08-30', '2026-08-01')).toThrow(/позже конца/);
  });

  it('считает дни между датами', () => {
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
    // переход на летнее время не должен давать 29.99 дня
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('берёт дату из отметки времени YAZIO', () => {
    expect(dayOf('2026-08-28 09:56:56')).toBe('2026-08-28');
    expect(dayOf('2026-08-28')).toBe('2026-08-28');
  });

  it('сворачивает к понедельнику и к первому числу', () => {
    expect(weekStart('2026-08-28')).toBe('2026-08-24'); // пятница → понедельник
    expect(weekStart('2026-08-24')).toBe('2026-08-24');
    expect(weekStart('2026-08-23')).toBe('2026-08-17'); // воскресенье — конец недели
    expect(monthStart('2026-08-28')).toBe('2026-08-01');
  });

  it('сегодня берёт локальную дату, а не UTC', () => {
    // 23:30 по местному времени — дата ещё сегодняшняя, хотя в UTC уже завтра
    const late = new Date(2026, 7, 28, 23, 30);
    expect(today(late)).toBe('2026-08-28');
  });
});
