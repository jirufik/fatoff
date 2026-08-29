import type { IsoDate, Text } from './common.js';

export type HealthImportStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** Файл выгрузки, найденный в смонтированном каталоге. */
export interface HealthFileDto {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface HealthImportDto {
  id: string;
  accountId: string;
  filePath: string;
  sizeBytes: number;
  bytesRead: number;
  /** `ExportDate` из самого файла — когда Apple его собрал. */
  exportedAt: string | null;
  status: HealthImportStatus;
  phase: string | null;
  records: number;
  workouts: number;
  days: number;
  from: IsoDate | null;
  to: IsoDate | null;
  /** Сколько записей какого типа встретилось. */
  typeCounts: Record<string, number>;
  warnings: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/**
 * День по данным Apple Health: сведён из разных типов в одну строку, на каждый
 * тип взят один источник — тот, что дал больше.
 */
export interface HealthDayRowDto {
  date: IsoDate;
  steps: number | null;
  activeKcal: number | null;
  basalKcal: number | null;
  exerciseMin: number | null;
  standHours: number | null;
  distanceKm: number | null;
  flights: number | null;
  restingHr: number | null;
  heartRateAvg: number | null;
  hrvMs: number | null;
  respiratoryRate: number | null;
  oxygenSaturation: number | null;
  asleepMin: number | null;
  deepMin: number | null;
  remMin: number | null;
  weightKg: number | null;
}

export interface HealthWorkoutRowDto {
  date: IsoDate;
  startedAt: string;
  type: string;
  durationMin: number;
  energyKcal: number | null;
  distanceKm: number | null;
  source: string | null;
}

export interface HealthSleepRowDto {
  night: IsoDate;
  source: string;
  inBedMin: number;
  asleepMin: number;
  deepMin: number;
  remMin: number;
  coreMin: number;
  awakeMin: number;
  fellAsleepAt: string | null;
  wokeAt: string | null;
}

/**
 * День, сведённый из обоих источников. Ради этой таблицы всё и делалось: YAZIO
 * знает приход энергии, Apple Health — расход, а вместе они дают баланс.
 */
export interface CombinedDayRowDto {
  date: IsoDate;
  energyInKcal: number | null;
  energyGoalKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
  waterMl: number | null;
  activeKcal: number | null;
  basalKcal: number | null;
  /** Съедено минус потрачено; пусто, если хоть одной половины нет. */
  balanceKcal: number | null;
  steps: number | null;
  exerciseMin: number | null;
  asleepMin: number | null;
  restingHr: number | null;
  weightYazioKg: number | null;
  weightHealthKg: number | null;
}

/**
 * Русские названия и группы видов тренировок.
 *
 * Список — те виды, что встречаются в её выгрузке, плюс несколько соседних.
 * Группа нужна генератору: правило «силовые не два дня подряд» опирается
 * именно на неё, а не на название.
 */
export type WorkoutGroupKey = 'cardio' | 'strength' | 'other';

export const WORKOUT_TITLES: Record<string, Text> = {
  Walking: {"ru": "Ходьба", "en": "Walking"},
  Running: {"ru": "Бег", "en": "Running"},
  Cycling: {"ru": "Велосипед", "en": "Cycling"},
  Elliptical: {"ru": "Эллипс", "en": "Elliptical"},
  Rowing: {"ru": "Гребля", "en": "Rowing"},
  Swimming: {"ru": "Плавание", "en": "Swimming"},
  Hiking: {"ru": "Поход", "en": "Hiking"},
  CrossCountrySkiing: {"ru": "Беговые лыжи", "en": "Cross-country skiing"},
  CardioDance: {"ru": "Танцевальное кардио", "en": "Dance cardio"},
  HighIntensityIntervalTraining: {"ru": "ВИИТ", "en": "HIIT"},
  TraditionalStrengthTraining: {"ru": "Силовая", "en": "Strength training"},
  FunctionalStrengthTraining: {"ru": "Функциональная", "en": "Functional strength"},
  CoreTraining: {"ru": "Мышцы кора", "en": "Core training"},
  CrossTraining: {"ru": "Кросс-тренинг", "en": "Cross-training"},
  Yoga: {"ru": "Йога", "en": "Yoga"},
  Flexibility: {"ru": "Растяжка", "en": "Stretching"},
  Pilates: {"ru": "Пилатес", "en": "Pilates"},
  Other: {"ru": "Другое", "en": "Other"},
};

export const WORKOUT_GROUPS: Record<string, WorkoutGroupKey> = {
  Walking: 'cardio',
  Running: 'cardio',
  Cycling: 'cardio',
  Elliptical: 'cardio',
  Rowing: 'cardio',
  Swimming: 'cardio',
  Hiking: 'cardio',
  CrossCountrySkiing: 'cardio',
  CardioDance: 'cardio',
  // ВИИТ — кардио по нагрузке, но по восстановлению ближе к силовой:
  // ставить его вплотную к силовому дню так же неудачно
  HighIntensityIntervalTraining: 'strength',
  TraditionalStrengthTraining: 'strength',
  FunctionalStrengthTraining: 'strength',
  CoreTraining: 'strength',
  CrossTraining: 'strength',
  Yoga: 'other',
  Flexibility: 'other',
  Pilates: 'other',
};

export function workoutTitle(type: string): Text {
  return WORKOUT_TITLES[type] ?? { ru: type, en: type };
}

export function workoutGroup(type: string): WorkoutGroupKey {
  return WORKOUT_GROUPS[type] ?? 'other';
}
