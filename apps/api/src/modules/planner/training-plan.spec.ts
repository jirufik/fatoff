import { describe, expect, it } from 'vitest';

import type { PlannedWorkoutDto, TrainingSettingsDto } from '@fatoff/contracts';

import { makeRng } from './menu-generator';
import {
  WHO_CARDIO_MIN,
  isoWeekday,
  placeWeek,
  planTraining,
  type TrainingProfile,
} from './training-plan';

/** Её виды тренировок с настоящими средними за последний год. */
const profile: TrainingProfile = {
  types: [
    { type: 'Walking', group: 'cardio', avgMin: 60, avgKcal: 127, count: 162 },
    { type: 'Running', group: 'cardio', avgMin: 54, avgKcal: 290, count: 50 },
    { type: 'TraditionalStrengthTraining', group: 'strength', avgMin: 32, avgKcal: 126, count: 37 },
    { type: 'Elliptical', group: 'cardio', avgMin: 22, avgKcal: 110, count: 35 },
    { type: 'Cycling', group: 'cardio', avgMin: 65, avgKcal: 133, count: 32 },
    { type: 'FunctionalStrengthTraining', group: 'strength', avgMin: 58, avgKcal: 178, count: 24 },
  ],
  sessionsPerWeek: 7.1,
  weekdayLoad: [60, 55, 58, 52, 50, 45, 47],
  medianSleepMin: 384,
};

/** Понедельник — воскресенье. */
const WEEK = [
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
];

const run = (settings: TrainingSettingsDto, dates = WEEK, deficit: number | null = 365) =>
  planTraining(dates, profile, settings, { deficitKcal: deficit }, makeRng(1));

const allDays = (plan: ReturnType<typeof run>, dates = WEEK): PlannedWorkoutDto[][] =>
  dates.map((date) => plan.byDate.get(date) ?? []);

describe('расстановка тренировок', () => {
  it('день недели считается от понедельника', () => {
    expect(isoWeekday('2026-08-31')).toBe(1);
    expect(isoWeekday('2026-09-06')).toBe(7);
  });

  for (const mode of ['current', 'who', 'goal'] as const) {
    it(`режим «${mode}»: силовые не два дня подряд`, () => {
      const days = allDays(run({ mode }));
      const strength = days.map((day) => day.some((workout) => workout.group === 'strength'));

      for (let i = 1; i < strength.length; i++) {
        expect(strength[i] && strength[i - 1]).toBe(false);
      }
    });

    it(`режим «${mode}»: остаётся день полного отдыха`, () => {
      expect(allDays(run({ mode })).some((day) => day.length === 0)).toBe(true);
    });

    it(`режим «${mode}»: длинное кардио не в один день с силовой`, () => {
      for (const day of allDays(run({ mode }))) {
        const hasStrength = day.some((workout) => workout.group === 'strength');
        const hasLongCardio = day.some(
          (workout) => workout.group === 'cardio' && workout.durationMin > 45,
        );
        expect(hasStrength && hasLongCardio).toBe(false);
      }
    });
  }

  it('«как сейчас» сохраняет нынешний объём', () => {
    const plan = run({ mode: 'current' });
    const count = allDays(plan).reduce((sum, day) => sum + day.length, 0);

    expect(count).toBe(7); // 7.1 в неделю округляется до семи
    expect(plan.notes.map((note) => note.code)).toContain('training.current');
  });

  it('семь занятий и день отдыха уживаются: одно занятие подсаживается ко второму', () => {
    const days = allDays(run({ mode: 'current' }));
    expect(days.filter((day) => day.length === 0)).toHaveLength(1);
    expect(days.filter((day) => day.length > 1)).toHaveLength(1);
  });

  it('«по ВОЗ» укладывается в норму кардио и даёт два силовых дня', () => {
    const days = allDays(run({ mode: 'who' }));
    const workouts = days.flat();

    const cardioMinutes = workouts
      .filter((workout) => workout.group === 'cardio')
      .reduce((sum, workout) => sum + workout.durationMin, 0);
    expect(cardioMinutes).toBeGreaterThanOrEqual(WHO_CARDIO_MIN[0]);
    expect(cardioMinutes).toBeLessThanOrEqual(WHO_CARDIO_MIN[1]);

    expect(days.filter((day) => day.some((w) => w.group === 'strength'))).toHaveLength(2);
  });

  it('«под цель» выводит объём из дефицита и срезает его при коротком сне', () => {
    const plan = run({ mode: 'goal' });
    const count = allDays(plan).reduce((sum, day) => sum + day.length, 0);

    expect(count).toBeLessThanOrEqual(5); // медиана сна 6.4 ч — потолок пять занятий
    expect(plan.notes.map((note) => note.code)).toContain('training.capped-by-sleep');
  });

  it('«под цель» без дефицита не выдумывает объём сверх минимума', () => {
    const plan = run({ mode: 'goal' }, WEEK, 0);
    const count = allDays(plan).reduce((sum, day) => sum + day.length, 0);
    expect(count).toBe(3);
  });

  it('«вручную» ставит ровно то, что задано, в заданные дни', () => {
    const plan = run({
      mode: 'manual',
      manual: [
        { weekday: 2, type: 'Running', durationMin: 40 },
        { weekday: 5, type: 'TraditionalStrengthTraining', durationMin: 50 },
      ],
    });

    const days = allDays(plan);
    expect(days.map((day) => day.length)).toEqual([0, 1, 0, 0, 1, 0, 0]);
    expect(days[1][0].type).toBe('Running');
    expect(days[1][0].durationMin).toBe(40);
    // затраты считаются по её собственной цене минуты: 290 ккал за 54 минуты
    expect(days[1][0].energyKcal).toBe(215);
    expect(days[4][0].group).toBe('strength');
  });

  it('«вручную» без единой тренировки говорит об этом прямо', () => {
    const plan = run({ mode: 'manual', manual: [] });
    expect(plan.notes.map((note) => note.code)).toContain('training.manual-empty');
  });

  it('силовая последнего дня недели не пускает силовую в понедельник следующей', () => {
    const strength: PlannedWorkoutDto = {
      type: 'TraditionalStrengthTraining',
      group: 'strength',
      durationMin: 32,
      energyKcal: 126,
    };
    const placed = placeWeek([strength], [1, 1, 1, 1, 1, 1, 9], true, makeRng(1));
    expect(placed[0]).toEqual([]);
  });

  it('расстановка идёт по её собственной привычке тренироваться', () => {
    // тренируется только по средам и субботам — туда занятия и встанут
    const rare: TrainingProfile = { ...profile, weekdayLoad: [0, 0, 40, 0, 0, 35, 0] };
    const plan = planTraining(WEEK, rare, { mode: 'current', sessionsPerWeek: 2 }, { deficitKcal: 365 }, makeRng(1));
    const days = allDays(plan);

    expect(days[2].length + days[5].length).toBe(2);
  });

  it('период длиннее недели повторяет расстановку по неделям', () => {
    const twoWeeks = [...WEEK, ...WEEK.map((date) => shift(date, 7))];
    const plan = run({ mode: 'who' }, twoWeeks);
    const counts = allDays(plan, twoWeeks).map((day) => day.length);

    expect(counts.slice(0, 7)).toEqual(counts.slice(7));
  });

  it('без истории тренировок план выходит пустым и говорит почему', () => {
    const empty: TrainingProfile = { types: [], sessionsPerWeek: 0, weekdayLoad: [], medianSleepMin: null };
    const plan = planTraining(WEEK, empty, { mode: 'current' }, { deficitKcal: 365 }, makeRng(1));

    expect(allDays(plan).flat()).toEqual([]);
    expect(plan.notes.map((note) => note.code)).toContain('training.no-history');
  });
});

function shift(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
