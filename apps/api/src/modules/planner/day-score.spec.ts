import { describe, expect, it } from 'vitest';

import { scoreDay, type ScoreInput } from './day-score';

const targets = { proteinG: 104, fiberG: 20, steps: 10_000, exerciseMin: 21, leanMassKg: 42.3 };

/** Идеальный день: каждая составляющая ровно в цели. */
const perfect = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  energyInKcal: 1450,
  energyOutKcal: 1800, // дефицит 350 — середина коридора
  proteinG: 104,
  fiberG: 20,
  steps: 10_000,
  exerciseMin: 21,
  asleepMin: 480, // 8 часов
  workoutKcal: 150,
  targets,
  ...over,
});

describe('оценка дня', () => {
  it('день, попавший во все цели, даёт 100', () => {
    const score = scoreDay(perfect());
    expect(score.total).toBe(100);
    expect(score.covered).toBe(6);
  });

  it('перебор над целью не наказывается', () => {
    expect(scoreDay(perfect({ proteinG: 140, steps: 22_000 })).total).toBe(100);
  });

  it('шкала линейная, а не «да/нет»', () => {
    // половина цели по шагам — половина её веса, то есть 7.5 из 100
    const half = scoreDay(perfect({ steps: 5000 }));
    expect(half.total).toBe(93);
    expect(half.parts.find((part) => part.key === 'steps')!.earned).toBe(7.5);
  });

  it('составляющая без данных выпадает из знаменателя, а не обнуляет', () => {
    const noSleep = scoreDay(perfect({ asleepMin: null }));
    expect(noSleep.total).toBe(100);
    expect(noSleep.covered).toBe(5);
    expect(noSleep.parts.find((part) => part.key === 'sleep')!.earned).toBeNull();
  });

  it('день без данных вовсе даёт пусто, а не ноль', () => {
    const empty = scoreDay({
      energyInKcal: null,
      energyOutKcal: null,
      proteinG: null,
      fiberG: null,
      steps: null,
      exerciseMin: null,
      asleepMin: null,
      workoutKcal: null,
      targets,
    });
    expect(empty.total).toBeNull();
    expect(empty.covered).toBe(0);
  });

  it('баланс полон внутри коридора дефицита и падает за его границами', () => {
    const inside = scoreDay(perfect({ energyInKcal: 1600 })); // дефицит 200, край коридора
    expect(inside.parts.find((part) => part.key === 'balance')!.earned).toBe(20);

    // ровный баланс — 200 ккал от коридора, спад 400: половина веса
    const even = scoreDay(perfect({ energyInKcal: 1800 }));
    expect(even.parts.find((part) => part.key === 'balance')!.earned).toBe(10);

    // профицит 400: 600 ккал от коридора — ноль
    const surplus = scoreDay(perfect({ energyInKcal: 2200 }));
    expect(surplus.parts.find((part) => part.key === 'balance')!.earned).toBe(0);
  });

  it('слишком большой дефицит тоже стоит баллов', () => {
    // дефицит 900: 400 за коридором, спад ровно 400 — ноль
    const deep = scoreDay(perfect({ energyInKcal: 900 }));
    expect(deep.parts.find((part) => part.key === 'balance')!.earned).toBe(0);
  });

  it('сон вне коридора 7–9 часов теряет часть веса', () => {
    // 6.4 ч = 384 мин, до коридора 36 мин, спад 120 → 0.7 веса
    const short = scoreDay(perfect({ asleepMin: 384 }));
    expect(short.parts.find((part) => part.key === 'sleep')!.earned).toBe(14);
    expect(short.parts.find((part) => part.key === 'sleep')!.note).toEqual({
      code: 'score.sleep',
      params: { hours: '6.4' },
    });
  });

  it('энергодоступность — отдельный флаг, а не штраф к баллам', () => {
    // (1000 − 150) / 42.3 = 20.1 — ниже порога 30
    const low = scoreDay(perfect({ energyInKcal: 1000, energyOutKcal: 1350 }));
    expect(low.energyAvailability).toBe(20.1);
    expect(low.lowEnergyAvailability).toBe(true);
    // баланс при этом ровно в коридоре, и баллы за него полные
    expect(low.parts.find((part) => part.key === 'balance')!.earned).toBe(20);
    expect(low.total).toBe(100);
  });

  it('не считает энергодоступность без безжировой массы', () => {
    const score = scoreDay(perfect({ targets: { ...targets, leanMassKg: null } }));
    expect(score.energyAvailability).toBeNull();
    expect(score.lowEnergyAvailability).toBe(false);
  });

  it('без заданной цели составляющая не считается', () => {
    const score = scoreDay(perfect({ targets: { ...targets, proteinG: null } }));
    expect(score.parts.find((part) => part.key === 'protein')!.earned).toBeNull();
    expect(score.parts.find((part) => part.key === 'protein')!.note.code).toBe('score.no-target');
    expect(score.covered).toBe(5);
  });

  it('в каждой составляющей видно, из чего сложился балл', () => {
    const score = scoreDay(perfect({ steps: 9500 }));
    const steps = score.parts.find((part) => part.key === 'steps')!;
    // разряды разделены неразрывным пробелом — так их отдаёт toLocaleString
    expect(steps.note).toEqual({
      code: 'score.of',
      params: { value: '9\u00a0500', target: '10\u00a0000' },
    });
    expect(steps.weight).toBe(15);
    expect(steps.earned).toBe(14.3);
  });

  it('единица уходит кодом сообщения, а не русским словом (D-044)', () => {
    const protein = scoreDay(perfect()).parts.find((part) => part.key === 'protein')!;
    expect(protein.note.code).toBe('score.of.g');
    expect(JSON.stringify(protein.note.params)).not.toMatch(/[а-яё]/i);
  });
});
