import {
  DEFICIT_CORRIDOR,
  FULL_DAY_MEALS,
  balanceZone,
  message,
  type AnalysisLineDto,
  type PeriodSummaryDto,
  type PeriodValueDto,
} from '@fatoff/contracts';

import { dateRange, daysBetween } from '../../common/date.util';

/**
 * Сводка за период и выводы словами — чистые функции.
 *
 * Базу видит сервис: он достаёт по строке на день, а всё дальнейшее считается
 * здесь. Итоги, график по дням и анализ стоят на одних и тех же строках, поэтому
 * разойтись между собой им не на чем (D-082, D-083).
 */

/** День периода: разбор дневника и свёртка Apple Health, сведённые по дате. */
export interface PeriodRow {
  date: string;
  /** Сколько приёмов пищи записано — по нему видно, полный ли день (D-078). */
  meals: number;
  eatenKcal: number | null;
  proteinG: number | null;
  burnedKcal: number | null;
  steps: number | null;
  workouts: number;
  workoutMin: number;
}

/** Меньше стольких дней вывод не делается: по двум дням «питание стабильное» — выдумка. */
export const ANALYSIS_MIN_DAYS = 3;

/** Разброс калорий от среднего: до первого порога — стабильно, после второго — рвано. */
export const STEADY_SPREAD_PCT = 10;
export const RAGGED_SPREAD_PCT = 25;

/** Доля полных дней с набранной нормой белка: «достаточно» и «не хватает». */
export const PROTEIN_ENOUGH_PCT = 75;
export const PROTEIN_SHORT_PCT = 50;

/**
 * С чем сравнивается активность: её же шаги за столько дней до периода.
 *
 * Сравнение с собой, а не с таблицей: десять тысяч шагов — чужая норма, и
 * человеку, который обычно проходит шесть, она ничего не говорит о том, как
 * прошла его неделя.
 */
export const ACTIVITY_BASELINE_DAYS = 90;
/** Меньше стольких дней с шагами до периода — сравнивать не с чем. */
export const ACTIVITY_BASELINE_MIN_DAYS = 14;
/** Разница с обычными шагами, внутри которой активность «как обычно». */
export const ACTIVITY_USUAL_PCT = 5;

/**
 * Итоги периода.
 *
 * Среднее — по дням, где данные есть, а не по всем дням периода: забытые на
 * тумбочке часы — это «не знаем», а не «не двигалась» (D-082). В ряду для графика
 * при этом стоит каждая дата: неделя без данных не должна схлопнуться, сдвинув
 * соседние дни друг к другу.
 */
export function summarizePeriod(
  rows: PeriodRow[],
  from: string,
  to: string,
): Omit<PeriodSummaryDto, 'analysis'> {
  const eaten = rows.filter((row) => row.eatenKcal !== null);
  const burned = rows.filter((row) => row.burnedKcal !== null);
  const both = rows.filter((row) => row.eatenKcal !== null && row.burnedKcal !== null);
  const walked = rows.filter((row) => row.steps !== null);
  const byDate = new Map(rows.map((row) => [row.date, row]));

  return {
    from,
    to,
    days: daysBetween(from, to) + 1,
    eaten: part(sum(eaten.map((row) => row.eatenKcal)), eaten.length),
    burned: part(sum(burned.map((row) => row.burnedKcal)), burned.length),
    balance: part(sum(both.map((row) => row.eatenKcal! - row.burnedKcal!)), both.length),
    // белок делится на дни с едой: день без записей — не день без белка
    proteinG: part(sum(rows.map((row) => row.proteinG)), eaten.length),
    steps: part(sum(walked.map((row) => row.steps)), walked.length),
    workouts: {
      count: rows.reduce((total, row) => total + row.workouts, 0),
      minutes: Math.round(rows.reduce((total, row) => total + row.workoutMin, 0)),
    },
    series: dateRange(from, to).map((date) => {
      const row = byDate.get(date);
      return {
        date,
        eatenKcal: round(row?.eatenKcal ?? null, 1),
        burnedKcal: round(row?.burnedKcal ?? null, 1),
      };
    }),
  };
}

export interface AnalysisInput {
  rows: PeriodRow[];
  /** Дней в периоде целиком. */
  periodDays: number;
  /** Норма белка из расчёта «Режима»; пусто — нет веса, и норму не посчитать. */
  proteinTargetG: number | null;
  /** Её обычные шаги: среднее за дни с шагами перед периодом. */
  baseline: { avgSteps: number | null; days: number };
}

/**
 * Анализ словами (D-085).
 *
 * Языковая модель для этого не нужна: каждый вывод — арифметика по её же данным,
 * и у каждого рядом лежит, на каких числах и по какому правилу он сделан. Где
 * данных мало, так и сказано — выдуманный по двум дням вывод хуже отсутствия
 * вывода.
 */
export function analyzePeriod(input: AnalysisInput): AnalysisLineDto[] {
  return [balanceLine(input), stabilityLine(input), proteinLine(input), activityLine(input)];
}

function balanceLine({ rows, periodDays }: AnalysisInput): AnalysisLineDto {
  const known = rows.filter((row) => row.eatenKcal !== null && row.burnedKcal !== null);
  const [low, high] = DEFICIT_CORRIDOR;
  const basis = message('analysis.balance.basis', { days: known.length, total: periodDays, low, high });

  if (known.length < ANALYSIS_MIN_DAYS) {
    return {
      key: 'balance',
      text: message('analysis.balance.few', { days: known.length, total: periodDays }),
      basis,
      tone: 'mute',
    };
  }

  const total = known.reduce((acc, row) => acc + row.eatenKcal! - row.burnedKcal!, 0);
  const avg = total / known.length;
  const figures = { avg: grouped(Math.abs(avg)), total: grouped(Math.abs(total)) };
  const line = (
    code: string,
    tone: AnalysisLineDto['tone'],
    params: Record<string, string | number> = figures,
  ): AnalysisLineDto => ({ key: 'balance', text: message(`analysis.balance.${code}`, params), basis, tone });

  switch (balanceZone(avg)) {
    case 'target':
      return line('target', 'ok');
    case 'small':
      return line('small', 'info');
    // глубокий дефицит — не успех, а недоедание: его и называем
    case 'deep':
      return line('deep', 'warn');
    case 'surplus':
      return line('surplus', 'warn');
    default:
      return line('even', 'info', { avg: signed(avg) });
  }
}

function stabilityLine({ rows }: AnalysisInput): AnalysisLineDto {
  // обрывок дня с одним завтраком — не «скачок калорий», а незаписанный день
  const full = rows.filter((row) => row.eatenKcal !== null && row.meals >= FULL_DAY_MEALS);
  const values = full.map((row) => row.eatenKcal!);
  const mean = average(values);
  // мало дней — пояснение говорит, чего не хватило, а не показывает прочерки
  if (full.length < ANALYSIS_MIN_DAYS || mean === null || mean <= 0) {
    return {
      key: 'stability',
      text: message('analysis.stability.few', { days: full.length }),
      basis: message('analysis.stability.basis-few', {
        meals: FULL_DAY_MEALS,
        days: full.length,
        min: ANALYSIS_MIN_DAYS,
      }),
      tone: 'mute',
    };
  }

  const basis = message('analysis.stability.basis', {
    meals: FULL_DAY_MEALS,
    days: full.length,
    avg: grouped(mean),
    steady: STEADY_SPREAD_PCT,
    ragged: RAGGED_SPREAD_PCT,
  });

  const spread = Math.round((deviation(values, mean) / mean) * 100);
  const [code, tone]: [string, AnalysisLineDto['tone']] =
    spread <= STEADY_SPREAD_PCT
      ? ['steady', 'ok']
      : spread <= RAGGED_SPREAD_PCT
        ? ['moderate', 'info']
        : ['ragged', 'warn'];

  return { key: 'stability', text: message(`analysis.stability.${code}`, { spread }), basis, tone };
}

function proteinLine({ rows, proteinTargetG }: AnalysisInput): AnalysisLineDto {
  const full = rows.filter((row) => row.meals >= FULL_DAY_MEALS && row.proteinG !== null);
  const avg = average(full.map((row) => row.proteinG!));

  if (proteinTargetG === null || proteinTargetG <= 0) {
    return {
      key: 'protein',
      text: message('analysis.protein.no-target'),
      basis: message('analysis.protein.basis-none'),
      tone: 'mute',
    };
  }
  if (full.length < ANALYSIS_MIN_DAYS || avg === null) {
    return {
      key: 'protein',
      text: message('analysis.protein.few', { days: full.length }),
      basis: message('analysis.protein.basis-few', {
        meals: FULL_DAY_MEALS,
        days: full.length,
        min: ANALYSIS_MIN_DAYS,
      }),
      tone: 'mute',
    };
  }

  const basis = message('analysis.protein.basis', {
    target: proteinTargetG,
    days: full.length,
    avg: Math.round(avg),
    enough: PROTEIN_ENOUGH_PCT,
    short: PROTEIN_SHORT_PCT,
  });

  const met = full.filter((row) => row.proteinG! >= proteinTargetG).length;
  const share = (met / full.length) * 100;
  const [code, tone]: [string, AnalysisLineDto['tone']] =
    share >= PROTEIN_ENOUGH_PCT
      ? ['enough', 'ok']
      : share >= PROTEIN_SHORT_PCT
        ? ['sometimes', 'info']
        : ['short', 'warn'];

  return {
    key: 'protein',
    text: message(`analysis.protein.${code}`, { met, days: full.length }),
    basis,
    tone,
  };
}

function activityLine({ rows, baseline }: AnalysisInput): AnalysisLineDto {
  const walked = rows.filter((row) => row.steps !== null);
  const avg = average(walked.map((row) => row.steps!));
  const base = baseline.avgSteps;

  if (walked.length < ANALYSIS_MIN_DAYS || avg === null) {
    return {
      key: 'activity',
      text: message('analysis.activity.few', { days: walked.length }),
      basis: message('analysis.activity.basis-few', { days: walked.length, min: ANALYSIS_MIN_DAYS }),
      tone: 'mute',
    };
  }
  if (base === null || base <= 0 || baseline.days < ACTIVITY_BASELINE_MIN_DAYS) {
    return {
      key: 'activity',
      text: message('analysis.activity.no-baseline', { avg: grouped(avg) }),
      basis: message('analysis.activity.basis-baseline', {
        window: ACTIVITY_BASELINE_DAYS,
        minBase: ACTIVITY_BASELINE_MIN_DAYS,
        baseDays: baseline.days,
      }),
      tone: 'info',
    };
  }

  const basis = message('analysis.activity.basis', {
    avg: grouped(avg),
    days: walked.length,
    base: grouped(base),
    window: ACTIVITY_BASELINE_DAYS,
    baseDays: baseline.days,
    usual: ACTIVITY_USUAL_PCT,
  });

  const diff = ((avg - base) / base) * 100;
  if (Math.abs(diff) < ACTIVITY_USUAL_PCT) {
    return { key: 'activity', text: message('analysis.activity.usual'), basis, tone: 'info' };
  }
  const pct = Math.round(Math.abs(diff));
  return diff > 0
    ? { key: 'activity', text: message('analysis.activity.above', { pct }), basis, tone: 'ok' }
    : { key: 'activity', text: message('analysis.activity.below', { pct }), basis, tone: 'warn' };
}

// ── арифметика ───────────────────────────────────────────────────────────────

/** Сумма известных значений; если не известно ни одно — пусто, а не ноль. */
function sum(values: Array<number | null>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function part(total: number | null, days: number): PeriodValueDto {
  return {
    avg: total === null || days === 0 ? null : round(total / days, 1),
    total: round(total, 1),
    days,
  };
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((acc, value) => acc + value, 0) / values.length;
}

/** Стандартное отклонение по всем дням — их и сравниваем, выборки тут нет. */
function deviation(values: number[], mean: number): number {
  return Math.sqrt(values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length);
}

function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Целое с пробелом между тысячами — так числа пишутся во всех сообщениях сервиса. */
function grouped(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

function signed(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${grouped(Math.abs(rounded))}`;
}
