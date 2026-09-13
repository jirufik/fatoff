import { DEFICIT_CORRIDOR, balanceZone } from '@fatoff/contracts';
import { describe, expect, it } from 'vitest';

import { DEFICIT_CORRIDOR as SCORE_CORRIDOR } from '../planner/day-score';
import {
  completeToOf,
  firstNameOf,
  foodOfDay,
  lastFullDay,
  trainingWeek,
  type WorkoutRow,
} from './home';

describe('зона баланса', () => {
  it('коридор дефицита включает свои границы, «ровно» — сотня вокруг нуля', () => {
    expect(balanceZone(-200)).toBe('target');
    expect(balanceZone(-500)).toBe('target');
    expect(balanceZone(-199)).toBe('small');
    expect(balanceZone(-501)).toBe('deep');
    expect(balanceZone(-100)).toBe('even');
    expect(balanceZone(100)).toBe('even');
    expect(balanceZone(101)).toBe('surplus');
  });

  it('это тот же коридор, за который оценка дня ставит полный балл', () => {
    // разойдись они — главный экран хвалил бы день, за который «День целиком» снимает баллы
    expect(SCORE_CORRIDOR).toBe(DEFICIT_CORRIDOR);
  });
});

describe('последний полный день', () => {
  it('берёт самый свежий день, где известны еда и расход и записано три приёма пищи', () => {
    const balance = lastFullDay([
      // утро: один завтрак против расхода за сутки — баланс вышел бы враньём
      { date: '2026-09-12', meals: 1, eatenKcal: 400, activeKcal: 500, basalKcal: 1300 },
      // расход не приехал
      { date: '2026-09-11', meals: 3, eatenKcal: 1400, activeKcal: null, basalKcal: null },
      { date: '2026-09-09', meals: 4, eatenKcal: 1500, activeKcal: 500, basalKcal: 1300 },
      { date: '2026-09-10', meals: 3, eatenKcal: 1450, activeKcal: 480, basalKcal: 1320 },
    ]);

    expect(balance).toEqual({
      date: '2026-09-10',
      eatenKcal: 1450,
      burnedKcal: 1800,
      activeKcal: 480,
      basalKcal: 1320,
      balanceKcal: -350,
      zone: 'target',
    });
  });

  it('без полного дня баланса нет, а не ноль', () => {
    expect(
      lastFullDay([{ date: '2026-09-12', meals: 2, eatenKcal: 900, activeKcal: 500, basalKcal: 1300 }]),
    ).toBeNull();
    expect(lastFullDay([])).toBeNull();
  });

  it('день сборки выгрузки полным не считается, даже записанный целиком', () => {
    const rows = [
      // выгрузку собрали 12-го днём: расход за 12-е в ней обрезан на часе сборки
      { date: '2026-09-12', meals: 3, eatenKcal: 1400, activeKcal: 200, basalKcal: 700 },
      { date: '2026-09-11', meals: 3, eatenKcal: 1450, activeKcal: 480, basalKcal: 1320 },
    ];

    expect(lastFullDay(rows)?.date).toBe('2026-09-12');
    expect(lastFullDay(rows, '2026-09-11')?.date).toBe('2026-09-11');
  });
});

describe('по какой день расход известен целиком', () => {
  it('день сборки выгрузки в ней обрезан', () => {
    expect(completeToOf('2026-09-12 15:40:00', '2026-09-12')).toBe('2026-09-11');
    // собрали после полуночи, а данных за новый день в выгрузке ещё нет
    expect(completeToOf('2026-09-13 00:20:00', '2026-09-12')).toBe('2026-09-12');
    // у давней загрузки даты сборки нет — данным верим как есть
    expect(completeToOf(null, '2026-09-12')).toBe('2026-09-12');
    expect(completeToOf('2026-09-12 15:40:00', null)).toBeNull();
  });
});

describe('питание за день', () => {
  it('идёт по приёмам в порядке дня, а неизвестное не превращает в ноль', () => {
    const food = foodOfDay([
      { meal: 'dinner', entries: 2, energyKcal: 360, proteinG: 30, carbsG: 20, fatG: 15, fiberG: null },
      { meal: 'breakfast', entries: 3, energyKcal: 420.26, proteinG: 25, carbsG: 50, fatG: 12, fiberG: null },
    ]);

    expect(food.meals.map((meal) => meal.meal)).toEqual(['breakfast', 'dinner']);
    expect(food.entries).toBe(5);
    expect(food.eaten).toEqual({ energyKcal: 780.3, proteinG: 55, carbsG: 70, fatG: 27, fiberG: null });
  });
});

describe('тренировки недели', () => {
  const workouts: WorkoutRow[] = [
    { date: '2026-09-07', type: 'FunctionalStrengthTraining', durationMin: 60, energyKcal: 170 },
    // та же дата: для нормы ВОЗ это всё ещё один силовой день
    { date: '2026-09-07', type: 'CoreTraining', durationMin: 15, energyKcal: 40 },
    { date: '2026-09-09', type: 'Walking', durationMin: 90, energyKcal: 230 },
    { date: '2026-09-10', type: 'Running', durationMin: 40.4, energyKcal: 300 },
    { date: '2026-09-11', type: 'Yoga', durationMin: 30, energyKcal: null },
    // воскресенье прошлой недели в эту не входит
    { date: '2026-09-06', type: 'Running', durationMin: 50, energyKcal: 350 },
  ];

  it('считает силовые дни и минуты кардио с понедельника', () => {
    const week = trainingWeek('2026-09-13', workouts, '2026-09-12');

    expect(week.from).toBe('2026-09-07');
    expect(week.to).toBe('2026-09-13');
    expect(week.strength).toEqual({ count: 1, goal: 2 });
    expect(week.cardio).toEqual({ minutes: 130, count: 2, goal: 150 });
    expect(week.workouts).toBe(5);
    expect(week.minutes).toBe(235);
    expect(week.energyKcal).toBe(740);
  });

  it('неделю, за которую часы ещё не приехали, не рисует нулями', () => {
    const stale = trainingWeek('2026-09-13', workouts, '2026-09-02');
    expect(stale.strength.count).toBeNull();
    expect(stale.cardio.minutes).toBeNull();
    expect(stale.workouts).toBeNull();
    expect(stale.energyKcal).toBeNull();

    expect(trainingWeek('2026-09-13', [], null).knownTo).toBeNull();
  });

  it('неделя с данными, но без тренировок — это честные нули', () => {
    const empty = trainingWeek('2026-09-13', [], '2026-09-12');
    expect(empty.strength.count).toBe(0);
    expect(empty.cardio.minutes).toBe(0);
    expect(empty.energyKcal).toBe(0);
  });
});

describe('имя в приветствии', () => {
  it('берётся из профиля YAZIO, пустое — не имя', () => {
    expect(firstNameOf({ first_name: '  Тестовая  ' })).toBe('Тестовая');
    expect(firstNameOf({ first_name: '' })).toBeNull();
    expect(firstNameOf({})).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
