import { message, type ScoreBreakdownDto, type ScorePartDto } from '@fatoff/contracts';

import { EA_THRESHOLD } from './targets';

/**
 * Оценка дня «с точки зрения здоровья».
 *
 * Число, за которым видно, из чего оно сложилось: шесть составляющих, у каждой
 * свой вес и свой источник (docs/ANALYSIS-NUTRITION.md). Две вещи, ради которых
 * это устроено именно так:
 *
 * — Шкала линейная, а не «да/нет». 9500 шагов из 10 000 — это не ноль.
 * — Составляющая без данных выпадает из знаменателя. День, о котором нам просто
 *   ничего не известно, не должен получать двойку за незнание; сколько
 *   составляющих участвовало, видно в `covered`.
 *
 * Низкая энергодоступность — отдельный флаг, а не штраф. Смысл у неё другой:
 * «дефицит по плану» и «организму не хватает на восстановление» — разные
 * утверждения, и растворять второе в баллах значит его спрятать.
 */

/** Целевой коридор дефицита: в нём балансу ставится полный балл. */
export const DEFICIT_CORRIDOR: [number, number] = [200, 500];
/** На сколько килокалорий за границей коридора балл падает до нуля. */
const BALANCE_FALLOFF = 400;

/** Сон: 7–9 часов, спад до нуля за два часа от границы. */
export const SLEEP_CORRIDOR: [number, number] = [420, 540];
const SLEEP_FALLOFF = 120;

/** 150 минут движения в неделю по ВОЗ — это чуть больше 21 минуты в день. */
export const EXERCISE_TARGET_MIN = 21;
export const STEPS_TARGET = 10_000;

export interface ScoreInput {
  energyInKcal: number | null;
  energyOutKcal: number | null;
  proteinG: number | null;
  fiberG: number | null;
  steps: number | null;
  exerciseMin: number | null;
  asleepMin: number | null;
  workoutKcal: number | null;
  targets: {
    proteinG: number | null;
    fiberG: number | null;
    steps: number;
    exerciseMin: number;
    leanMassKg: number | null;
  };
}

export function scoreDay(input: ScoreInput): ScoreBreakdownDto {
  const { targets } = input;
  const parts: ScorePartDto[] = [];

  const balance =
    input.energyInKcal !== null && input.energyOutKcal !== null
      ? input.energyInKcal - input.energyOutKcal
      : null;

  parts.push({
    key: 'balance',
    value: balance,
    target: -((DEFICIT_CORRIDOR[0] + DEFICIT_CORRIDOR[1]) / 2),
    weight: 20,
    earned: balance === null ? null : 20 * balanceShare(balance),
    note:
      balance === null
        ? message('score.balance-unknown')
        : message('score.balance', {
            value: fmt(balance),
            low: DEFICIT_CORRIDOR[0],
            high: DEFICIT_CORRIDOR[1],
          }),
  });

  parts.push(
    atLeast({
      key: 'protein',
      value: input.proteinG,
      target: targets.proteinG,
      weight: 20,
      unit: 'г',
    }),
  );

  parts.push(
    atLeast({
      key: 'fiber',
      value: input.fiberG,
      target: targets.fiberG,
      weight: 10,
      unit: 'г',
    }),
  );

  parts.push(
    atLeast({
      key: 'steps',
      value: input.steps,
      target: targets.steps,
      weight: 15,
      unit: '',
    }),
  );

  parts.push(
    atLeast({
      key: 'exercise',
      value: input.exerciseMin,
      target: targets.exerciseMin,
      weight: 15,
      unit: 'мин',
    }),
  );

  parts.push({
    key: 'sleep',
    value: input.asleepMin,
    target: SLEEP_CORRIDOR[0],
    weight: 20,
    earned:
      input.asleepMin === null
        ? null
        : 20 * corridorShare(input.asleepMin, SLEEP_CORRIDOR, SLEEP_FALLOFF),
    note:
      input.asleepMin === null
        ? message('score.no-data')
        : message('score.sleep', { hours: (input.asleepMin / 60).toFixed(1) }),
  });

  const covered = parts.filter((part) => part.earned !== null);
  const weight = covered.reduce((sum, part) => sum + part.weight, 0);
  const earned = covered.reduce((sum, part) => sum + (part.earned ?? 0), 0);

  const availability =
    targets.leanMassKg && input.energyInKcal !== null
      ? Math.round(((input.energyInKcal - (input.workoutKcal ?? 0)) / targets.leanMassKg) * 10) / 10
      : null;

  return {
    total: weight > 0 ? Math.round((earned / weight) * 100) : null,
    covered: covered.length,
    parts: parts.map((part) => ({
      ...part,
      earned: part.earned === null ? null : Math.round(part.earned * 10) / 10,
    })),
    lowEnergyAvailability: availability !== null && availability < EA_THRESHOLD,
    energyAvailability: availability,
  };
}

/** «Не ниже цели»: доля до цели, дальше единица. Перебор целью не наказывается. */
function atLeast(input: {
  key: string;
  value: number | null;
  target: number | null;
  weight: number;
  unit: string;
}): ScorePartDto {
  const { value, target } = input;
  const usable = target !== null && target > 0;
  const share = value === null || !usable ? null : Math.min(1, Math.max(0, value / target));

  return {
    key: input.key,
    value,
    target: target ?? 0,
    weight: input.weight,
    earned: share === null ? null : input.weight * share,
    note:
      value === null
        ? message('score.no-data')
        : !usable
          ? message('score.no-target')
          : message('score.of', { value: fmt(value), target: fmt(target), unit: input.unit }),
  };
}

/** Баланс: полный балл внутри коридора дефицита, спад в обе стороны. */
function balanceShare(balance: number): number {
  const deficit = -balance;
  return corridorShare(deficit, DEFICIT_CORRIDOR, BALANCE_FALLOFF);
}

function corridorShare(value: number, [low, high]: [number, number], falloff: number): number {
  if (value >= low && value <= high) return 1;
  const distance = value < low ? low - value : value - high;
  return Math.max(0, 1 - distance / falloff);
}

function fmt(value: number): string {
  return Math.abs(value) >= 1000
    ? Math.round(value).toLocaleString('ru-RU')
    : String(Math.round(value * 10) / 10);
}
