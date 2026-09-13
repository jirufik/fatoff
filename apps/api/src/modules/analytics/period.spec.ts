import { describe, expect, it } from 'vitest';

import { analyzePeriod, summarizePeriod, type AnalysisInput, type PeriodRow } from './period';

const day = (date: string, over: Partial<PeriodRow> = {}): PeriodRow => ({
  date,
  meals: 3,
  eatenKcal: 1400,
  proteinG: 100,
  burnedKcal: 1750,
  steps: 10_000,
  workouts: 0,
  workoutMin: 0,
  ...over,
});

/** Неделя 1–7 сентября; `over` правит отдельные дни по номеру. */
const week = (over: (index: number) => Partial<PeriodRow> = () => ({})): PeriodRow[] =>
  Array.from({ length: 7 }, (_, index) => day(`2026-09-0${index + 1}`, over(index)));

const base: Omit<AnalysisInput, 'rows'> = {
  periodDays: 7,
  proteinTargetG: 94,
  baseline: { avgSteps: 10_000, days: 80 },
};

const lineOf = (rows: PeriodRow[], key: string, input: Partial<AnalysisInput> = {}) =>
  analyzePeriod({ ...base, ...input, rows }).find((line) => line.key === key)!;

describe('сводка за период', () => {
  it('в ряду для графика стоит каждая дата периода, даже без данных', () => {
    const summary = summarizePeriod([day('2026-09-02'), day('2026-09-05')], '2026-09-01', '2026-09-07');

    expect(summary.series.map((point) => point.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
    // день без данных — пустые значения, а не нули и не пропуск
    expect(summary.series[0]).toEqual({ date: '2026-09-01', eatenKcal: null, burnedKcal: null });
    expect(summary.series[1]).toEqual({ date: '2026-09-02', eatenKcal: 1400, burnedKcal: 1750 });
  });

  it('среднее — по дням с данными, баланс — только где известны обе половины', () => {
    const summary = summarizePeriod(
      [
        day('2026-09-01'),
        day('2026-09-02', { burnedKcal: null }),
        day('2026-09-03', { eatenKcal: null, proteinG: null, meals: 0 }),
      ],
      '2026-09-01',
      '2026-09-07',
    );

    expect(summary.days).toBe(7);
    expect(summary.eaten).toEqual({ avg: 1400, total: 2800, days: 2 });
    expect(summary.burned).toEqual({ avg: 1750, total: 3500, days: 2 });
    expect(summary.balance).toEqual({ avg: -350, total: -350, days: 1 });
    expect(summary.proteinG).toEqual({ avg: 100, total: 200, days: 2 });
  });

  it('период без единого дня данных отдаёт пустые числа, а не нули', () => {
    const summary = summarizePeriod([], '2026-09-01', '2026-09-07');

    expect(summary.eaten).toEqual({ avg: null, total: null, days: 0 });
    expect(summary.balance).toEqual({ avg: null, total: null, days: 0 });
    expect(summary.workouts).toEqual({ count: 0, minutes: 0 });
    expect(summary.series).toHaveLength(7);
  });
});

describe('анализ словами', () => {
  it('каждый вывод приходит вместе с числами, на которых он стоит', () => {
    const lines = analyzePeriod({ ...base, rows: week() });

    expect(lines.map((line) => line.key)).toEqual(['balance', 'stability', 'protein', 'activity']);
    for (const line of lines) {
      expect(line.basis.code).toBe(`analysis.${line.key}.basis`);
    }
  });

  it('когда данных мало, пояснение говорит, чего не хватило, а не показывает прочерки', () => {
    const lines = analyzePeriod({ ...base, rows: [day('2026-09-01', { burnedKcal: null, steps: null })] });

    expect(lines.find((line) => line.key === 'stability')!.basis).toEqual({
      code: 'analysis.stability.basis-few',
      params: { meals: 3, days: 1, min: 3 },
    });
    expect(lines.find((line) => line.key === 'activity')!.basis.code).toBe('analysis.activity.basis-few');
    for (const line of lines) {
      expect(JSON.stringify(line.basis.params ?? {})).not.toContain('—');
    }
  });

  it('дефицит в коридоре хвалит, а глубокий называет глубоким', () => {
    const target = lineOf(week(), 'balance');
    expect(target.text).toEqual({
      code: 'analysis.balance.target',
      params: { avg: '350', total: (2450).toLocaleString('ru-RU') },
    });
    expect(target.tone).toBe('ok');

    // −800 в день — не успех, а недоедание
    const deep = lineOf(week(() => ({ burnedKcal: 2200 })), 'balance');
    expect(deep.text.code).toBe('analysis.balance.deep');
    expect(deep.tone).toBe('warn');

    const surplus = lineOf(week(() => ({ eatenKcal: 2000 })), 'balance');
    expect(surplus.text.code).toBe('analysis.balance.surplus');
  });

  it('о балансе не судит по двум дням из семи', () => {
    const line = lineOf(week((index) => (index < 5 ? { burnedKcal: null } : {})), 'balance');

    expect(line.text).toEqual({ code: 'analysis.balance.few', params: { days: 2, total: 7 } });
    expect(line.tone).toBe('mute');
  });

  it('ровность питания считает по полным дням: обрывок дня её не портит', () => {
    // шесть ровных дней и один, где записан только завтрак
    const rows = week((index) =>
      index === 6 ? { eatenKcal: 300, meals: 1 } : { eatenKcal: index % 2 === 0 ? 1450 : 1350 },
    );
    const line = lineOf(rows, 'stability');

    expect(line.text.code).toBe('analysis.stability.steady');
    expect(line.basis.params).toMatchObject({ days: 6, meals: 3 });
  });

  it('скачущие калории называет рваным питанием', () => {
    const line = lineOf(week((index) => ({ eatenKcal: index % 2 === 0 ? 900 : 1900 })), 'stability');

    expect(line.text.code).toBe('analysis.stability.ragged');
    expect(line.tone).toBe('warn');
  });

  it('белок оценивает долей дней, где норма набрана', () => {
    // 6 из 7 — достаточно, 4 из 7 — не всегда, 2 из 7 — не хватает
    expect(lineOf(week((i) => ({ proteinG: i === 0 ? 80 : 100 })), 'protein').text).toEqual({
      code: 'analysis.protein.enough',
      params: { met: 6, days: 7 },
    });
    expect(lineOf(week((i) => ({ proteinG: i < 3 ? 80 : 100 })), 'protein').text.code).toBe(
      'analysis.protein.sometimes',
    );
    expect(lineOf(week((i) => ({ proteinG: i < 5 ? 80 : 100 })), 'protein').text.code).toBe(
      'analysis.protein.short',
    );
  });

  it('без нормы белка вывода не выдумывает', () => {
    const line = lineOf(week(), 'protein', { proteinTargetG: null });

    expect(line.text.code).toBe('analysis.protein.no-target');
    expect(line.tone).toBe('mute');
  });

  it('активность сравнивает с её же обычными шагами', () => {
    const above = lineOf(week(() => ({ steps: 11_200 })), 'activity');
    expect(above.text).toEqual({ code: 'analysis.activity.above', params: { pct: 12 } });

    // три процента — это не «выше обычной», а обычная неделя
    expect(lineOf(week(() => ({ steps: 10_300 })), 'activity').text.code).toBe('analysis.activity.usual');

    const below = lineOf(week(() => ({ steps: 8000 })), 'activity');
    expect(below.text).toEqual({ code: 'analysis.activity.below', params: { pct: 20 } });
    expect(below.tone).toBe('warn');
  });

  it('когда сравнивать не с чем, говорит об этом прямо', () => {
    const line = lineOf(week(), 'activity', { baseline: { avgSteps: 9000, days: 5 } });

    expect(line.text.code).toBe('analysis.activity.no-baseline');
  });
});
