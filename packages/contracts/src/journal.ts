import type { IsoDate, Message, Text } from './common.js';

/** Приёмы пищи YAZIO. Порядок — как в дне, а не алфавитный. */
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealKey = (typeof MEALS)[number];

export const MEAL_TITLES: Record<MealKey, Text> = {
  breakfast: { ru: 'Завтрак', en: 'Breakfast' },
  lunch: { ru: 'Обед', en: 'Lunch' },
  dinner: { ru: 'Ужин', en: 'Dinner' },
  snack: { ru: 'Перекус', en: 'Snack' },
};

/** Основные приёмы: к ним применяется порог белка 0.4 г/кг. */
export const MAIN_MEALS: readonly MealKey[] = ['breakfast', 'lunch', 'dinner'];

export type BalanceState = 'deficit' | 'even' | 'surplus';

/**
 * Коридор вокруг нуля, в котором баланс считается ровным.
 *
 * Точность обеих половин — оценка YAZIO против оценки часов — не даёт права
 * называть 12 ккал профицитом.
 */
export const BALANCE_EVEN_KCAL = 100;

/** Оценка дня считается в Node, а не в SQL, поэтому сортировки по ней нет. */
export type JournalSort = 'date' | 'balance' | 'energy' | 'steps';

export interface JournalQuery {
  from?: IsoDate;
  to?: IsoDate;
  /** Только дни, где есть хотя бы одна запись о еде. */
  withFood?: boolean;
  /** Только дни, где известны обе половины: и съедено, и потрачено. */
  withBalance?: boolean;
  page?: number;
  pageSize?: number;
  sort?: JournalSort;
  dir?: 'asc' | 'desc';
}

/** Строка дня: обе половины сведены, подробности догружаются отдельно. */
export interface JournalDayDto {
  date: IsoDate;
  weekday: number;

  energyInKcal: number | null;
  energyGoalKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
  meals: number;
  entries: number;

  activeKcal: number | null;
  basalKcal: number | null;
  energyOutKcal: number | null;
  steps: number | null;
  workouts: number;
  workoutKcal: number | null;
  exerciseMin: number | null;

  balanceKcal: number | null;
  /** Считается на сервере: цвет не должен зависеть от того, как клиент понял знак. */
  balance: BalanceState | null;

  asleepMin: number | null;
  waterMl: number | null;
  weightKg: number | null;

  score: number | null;
}

export interface JournalItemDto {
  kind: 'product' | 'recipe_portion' | 'simple_product';
  sourceId: string | null;
  name: string;
  producer: string | null;
  amount: number | null;
  unit: string | null;
  serving: string | null;
  loggedAt: string | null;
  energyKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
}

export interface JournalMealDto {
  meal: MealKey | string;
  items: JournalItemDto[];
  energyKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
}

export interface JournalWorkoutDto {
  startedAt: string;
  type: string;
  durationMin: number;
  energyKcal: number | null;
  distanceKm: number | null;
  source: string | null;
}

/** Из чего сложился расход. Активная энергия шире суммы тренировок — это не ошибка. */
export interface BurnBreakdownDto {
  basalKcal: number | null;
  activeKcal: number | null;
  workoutKcal: number | null;
  totalKcal: number | null;
  steps: number | null;
  distanceKm: number | null;
  exerciseMin: number | null;
  standHours: number | null;
  restingHr: number | null;
}

export interface ScorePartDto {
  key: string;
  value: number | null;
  target: number;
  weight: number;
  /** Сколько из `weight` набрано; `null`, если данных нет и составляющая не в счёт. */
  earned: number | null;
  /** Почему столько: `{ code, params }`, текст собирает интерфейс. */
  note: Message;
}

export interface ScoreBreakdownDto {
  /** 0–100 по покрытым составляющим; `null`, если не покрыта ни одна. */
  total: number | null;
  covered: number;
  parts: ScorePartDto[];
  /** Энергодоступность ниже 30 ккал/кг БЖМ — флаг, а не штраф к баллам. */
  lowEnergyAvailability: boolean;
  energyAvailability: number | null;
}

export interface JournalDayDetailDto {
  date: IsoDate;
  meals: JournalMealDto[];
  workouts: JournalWorkoutDto[];
  burn: BurnBreakdownDto;
  score: ScoreBreakdownDto;
}
