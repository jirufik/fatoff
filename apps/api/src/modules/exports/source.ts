import type { Dataset } from '@fatoff/contracts';

import type {
  YazioConsumedItems,
  YazioDietaryPreferences,
  YazioExercises,
  YazioFastingSession,
  YazioFeeling,
  YazioGoals,
  YazioProduct,
  YazioRecipe,
  YazioSettings,
  YazioStreak,
  YazioSubscription,
  YazioUser,
  YazioWater,
} from '../yazio/yazio.types';

/** Сырьё одного дня, как оно лежит в базе. `null` — «не запрашивали». */
export interface DaySource {
  consumed: YazioConsumedItems | null;
  exercises: YazioExercises | null;
  water: YazioWater | null;
  goals: YazioGoals | null;
  goalsUnmodified: YazioGoals | null;
  feeling: YazioFeeling | null;
}

export interface DayTotals {
  energy: number;
  carb: number;
  protein: number;
  fat: number;
  energyGoal: number;
}

export interface BodyValueRow {
  kind: string;
  loggedAt: string;
  date: string;
  value: number;
}

/**
 * Всё, что нужно для сборки выгрузки, уже прочитанное из базы.
 *
 * Построители таблиц принимают только это: ни базы, ни сети они не знают, и
 * потому проверяются прямыми тестами (D-003).
 */
export interface ExportSource {
  from: string;
  to: string;
  datasets: Set<Dataset>;
  redact: boolean;

  user: YazioUser | null;
  settings: YazioSettings | null;
  dietaryPreferences: YazioDietaryPreferences | null;
  subscriptions: YazioSubscription[];
  streak: YazioStreak;
  fasting: YazioFastingSession[];

  /** Итоги, посчитанные самим YAZIO. Ключ — дата. */
  dailyNutrients: Map<string, DayTotals>;
  dailyExercise: Map<string, { steps: number; duration: number; energy: number }>;
  bodyValues: BodyValueRow[];

  days: Map<string, DaySource>;
  products: Map<string, YazioProduct>;
  recipes: Map<string, { recipe: YazioRecipe; isUserRecipe: boolean }>;

  /** `null`, если выгрузка Apple Health не загружена или выключена. */
  health: HealthSource | null;
}

/**
 * Данные Apple Health, уже сведённые по дням: на каждый день и тип оставлен
 * один источник (см. docs/APPLE-HEALTH.md, § 2.1).
 */
export interface HealthSource {
  days: Map<string, HealthDayValues>;
  workouts: HealthWorkoutValues[];
  sleep: Map<string, HealthSleepValues>;
}

export interface HealthDayValues {
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
  weightKg: number | null;
}

export interface HealthWorkoutValues {
  date: string;
  startedAt: string;
  type: string;
  durationMin: number;
  energyKcal: number | null;
  distanceKm: number | null;
  source: string | null;
}

export interface HealthSleepValues {
  night: string;
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

/** Проблема, замеченная при сборке: она станет строкой таблицы `warnings`. */
export interface BuildWarning {
  phase: string;
  key: string | null;
  message: string;
}
