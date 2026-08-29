import type { IsoDate, Message, Text } from './common.js';
import type { BalanceState, MealKey } from './journal.js';

// ── нормы ────────────────────────────────────────────────────────────────────

export interface MacroSetDto {
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
}

export interface ProfileFactsDto {
  sex: 'female' | 'male' | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  bmi: number | null;
}

export interface ExpenditureFactsDto {
  /** Медианы по дням с данными Apple Health. */
  basalKcal: number | null;
  activeKcal: number | null;
  totalKcal: number | null;
  /** Формула Миффлина–Сан-Жеора — как проверка порядка величины, не как источник. */
  mifflinKcal: number | null;
  /** Средняя энергия тренировок по всем дням периода, не только тренировочным. */
  workoutKcalPerDay: number | null;
  /**
   * Активная энергия без записанных тренировок — обычное движение за день.
   * Из неё складывается прикидка расхода в дне плана: базальный обмен плюс это
   * плюс энергия запланированных на день занятий.
   */
  activeWithoutWorkoutsKcal: number | null;
  daysCovered: number;
}

export interface EnergyAvailabilityDto {
  /** Сейчас: (съедено − тренировки) / БЖМ. */
  current: number | null;
  /** При расчётных целях. */
  atTarget: number | null;
  /** Порог низкой энергодоступности у женщин по консенсусу МОК. */
  threshold: number;
  optimal: number;
}

/**
 * Нормы: расчёт и цели YAZIO рядом.
 *
 * Показываются обе колонки — расхождение между ними само по себе информация,
 * и прятать одну из них значит принимать решение за человека.
 */
export interface TargetsDto {
  profile: ProfileFactsDto;
  expenditure: ExpenditureFactsDto;
  /** Темп снижения веса, % массы тела в неделю. */
  lossRatePctPerWeek: number;
  deficitKcal: number | null;
  computed: MacroSetDto;
  yazio: MacroSetDto;
  /** `computed − yazio`; пусто там, где не с чем сравнивать. */
  diff: MacroSetDto;
  /** Порог белка на один основной приём пищи, 0.4 г/кг. */
  proteinPerMealG: number | null;
  energyAvailability: EnergyAvailabilityDto;
  /** Откуда взялось каждое расчётное число. */
  basis: Record<string, Message>;
  warnings: Message[];
}

export const LOSS_RATE_MIN = 0.3;
export const LOSS_RATE_MAX = 1;
export const LOSS_RATE_DEFAULT = 0.65;

// ── пул продуктов ────────────────────────────────────────────────────────────

/** Питательность на одну базовую единицу — грамм, миллилитр или порцию рецепта. */
export interface PerUnitDto {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface PoolItemDto {
  key: string;
  kind: 'product' | 'recipe';
  sourceId: string;
  name: string;
  producer: string | null;
  baseUnit: string | null;
  /** Порция, если у продукта она есть: «штука», «ложка». Округление идёт к ней. */
  serving: string | null;
  servingAmount: number | null;
  /** В каких приёмах пищи она это ела. Овсянка не поедет в ужин. */
  meals: MealKey[];
  entries: number;
  lastUsed: IsoDate | null;
  /** Медиана съеденного — устойчива к одной записи в 400 г. */
  typicalAmount: number;
  minAmount: number;
  maxAmount: number;
  per: PerUnitDto;
}

// ── настройки целей ──────────────────────────────────────────────────────────

/**
 * Всё, что определяет целевые числа. Ни одно не зашито в код: у каждого есть
 * значение по умолчанию из рекомендаций и границы, в которых его можно двигать
 * (см. `PLANNER_SETTINGS` и docs/ANALYSIS-NUTRITION.md).
 */
export interface TargetSettingsDto {
  /** Темп снижения веса, % массы тела в неделю. Отсюда считается дефицит. */
  lossRatePctPerWeek: number;
  proteinPerKg: number;
  fatPerKg: number;
  fiberPer1000Kcal: number;
  /** Порог белка на один основной приём пищи, г/кг массы тела. */
  proteinPerMealPerKg: number;
  /** Прибавлять ли энергию тренировки к целям тренировочного дня. */
  addWorkoutEnergy: boolean;
  /**
   * Задать целевые калории напрямую вместо расчёта из расхода и дефицита.
   * `null` — считать по формуле.
   */
  energyOverrideKcal: number | null;
  /** Доли дневной калорийности по приёмам пищи; нормируются к сумме. */
  mealShares: Record<MealKey, number>;
}

// ── настройки подбора ────────────────────────────────────────────────────────

/** Веса отклонений в оценке набора: во что генератор целится в первую очередь. */
export interface SelectionWeightsDto {
  energy: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** Штраф за каждую позицию сверх минимума — против меню из десяти мелочей. */
  items: number;
  /** Штраф за повтор продукта внутри окна разнообразия. */
  repeat: number;
}

export interface AlgorithmSettingsDto {
  weights: SelectionWeightsDto;
  /** Допуск по калориям, % от цели приёма пищи. */
  energyTolerancePct: number;
  /** Сколько частичных наборов держит лучевой поиск. Больше — точнее и дольше. */
  beamWidth: number;
  minItemsPerMeal: number;
  maxItemsPerMeal: number;
  /** Шаг округления граммовки. «73.4 г творога» никто выполнять не станет. */
  roundToG: number;
  /** Насколько можно отойти от её типичной порции: доли от неё. */
  minPortionFactor: number;
  maxPortionFactor: number;
  varietyWindowDays: number;
  maxRepeats: number;
  /** Продукт попадает в пул, если встречался не реже этого. */
  poolMinEntries: number;
  /** …и хотя бы раз за столько месяцев. */
  poolLastUsedMonths: number;
  /** Проходов локального улучшения после лучевого поиска. */
  localSearchPasses: number;
}

// ── генератор ────────────────────────────────────────────────────────────────

export const TRAINING_MODES = ['current', 'who', 'manual', 'goal'] as const;
export type TrainingMode = (typeof TRAINING_MODES)[number];

export const TRAINING_MODE_TITLES: Record<TrainingMode, Text> = {
  current: { ru: 'Как сейчас', en: 'As it is now' },
  who: { ru: 'По нормам ВОЗ', en: 'WHO minimum' },
  manual: { ru: 'Задать вручную', en: 'Set by hand' },
  goal: { ru: 'Под цель', en: 'Driven by the goal' },
};

export const TRAINING_MODE_NOTES: Record<TrainingMode, Text> = {
  current: {
    ru: 'Сохраняет нынешний недельный объём, но расставляет по правилам восстановления: силовые не подряд, есть день отдыха',
    en: 'Keeps the current weekly volume but lays it out by recovery rules: no back-to-back strength days, one full rest day',
  },
  who: {
    ru: '150–300 минут умеренного кардио и два силовых дня в неделю — минимум из руководства ВОЗ 2020',
    en: '150–300 minutes of moderate cardio and two strength days a week — the minimum from the WHO 2020 guidelines',
  },
  manual: {
    ru: 'Тренировки задаёте вы, генератор подстраивает под них питание',
    en: 'You set the sessions, the generator fits the food around them',
  },
  goal: {
    ru: 'Объём выводится из целевого дефицита и восстановления — столько, сколько нужно, чтобы дефицит набирался не одной едой',
    en: 'Volume follows from the target deficit and recovery — enough that the deficit is not carried by food alone',
  },
};

export type WorkoutGroup = 'cardio' | 'strength' | 'other';

/** Тренировка, заданная вручную: день недели, 1 — понедельник. */
export interface ManualWorkoutDto {
  weekday: number;
  type: string;
  durationMin: number;
}

export interface TrainingSettingsDto {
  mode: TrainingMode;
  manual?: ManualWorkoutDto[];
  /** Для `current`, `who` и `goal`: сколько занятий в неделю, если задать явно. */
  sessionsPerWeek?: number;
  /** Сколько из них силовых. */
  strengthPerWeek?: number;
}

/** Из чего разрешено собирать меню. */
export interface PoolFilterDto {
  /** Брать записи дневника только за этот период; пусто — как задано в настройках. */
  from?: IsoDate;
  to?: IsoDate;
  /** Ограничить подбор этими продуктами; пусто — весь пул. */
  keys?: string[];
}

/**
 * Блюдо, закреплённое человеком: генератор обязан его поставить и добирает
 * остальное вокруг него.
 */
export interface PinnedDto {
  /** Пусто — во все дни периода. */
  date?: IsoDate;
  meal: MealKey;
  key: string;
  /** Пусто — привычная порция. */
  amount?: number;
}

export interface GenerateRequest {
  from: IsoDate;
  to: IsoDate;
  meals?: MealKey[];
  training: TrainingSettingsDto;
  targets?: Partial<TargetSettingsDto>;
  algorithm?: Partial<AlgorithmSettingsDto>;
  pool?: PoolFilterDto;
  pinned?: PinnedDto[];
  /** Одно зерно — один и тот же план. Хранится вместе с планом. */
  seed?: number;
}

/**
 * Пересчёт одного дня после ручной правки: заменили блюдо или поменяли
 * граммовку. Арифметика остаётся на сервере — в браузере её второй копии нет.
 */
export interface RecostRequest {
  date: IsoDate;
  workoutKcal: number;
  meals: Array<{ meal: MealKey; items: Array<{ key: string; amount: number }> }>;
  targets?: Partial<TargetSettingsDto>;
  algorithm?: Partial<AlgorithmSettingsDto>;
  pool?: PoolFilterDto;
}

export interface PlannedItemDto {
  key: string;
  /** Поставлено человеком, а не подбором: генератор такое не трогает. */
  pinned?: boolean;
  name: string;
  amount: number;
  unit: string;
  serving: string | null;
  servings: number | null;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface PlannedMealDto {
  meal: MealKey;
  targetKcal: number;
  targetProteinG: number;
  items: PlannedItemDto[];
  totals: MacroSetDto;
}

export interface PlannedWorkoutDto {
  type: string;
  group: WorkoutGroup;
  durationMin: number;
  energyKcal: number;
}

/**
 * Вид тренировки с её ценой минуты — по её собственной истории.
 *
 * Едет вместе с планом, чтобы тренировку можно было добавить или удлинить, а
 * затраты пересчитались: у неё ходьба стоит около 2 ккал в минуту, а бег — пяти.
 */
export interface WorkoutTypeDto {
  type: string;
  group: WorkoutGroup;
  avgMin: number;
  kcalPerMin: number;
  /** Сколько таких занятий в её истории — по этому виды и сортируются. */
  count: number;
}

export interface PlanDayDto {
  date: IsoDate;
  weekday: number;
  targets: MacroSetDto;
  totals: MacroSetDto;
  meals: PlannedMealDto[];
  workouts: PlannedWorkoutDto[];
  workoutKcal: number;
  /**
   * Прикидка расхода: базальный обмен плюс обычное движение плюс запланированные
   * тренировки. Точно посчитать будущее нельзя — это ориентир, и назван он так.
   */
  burnKcal: number | null;
  balanceKcal: number | null;
  balance: BalanceState | null;
  energyAvailability: number | null;
  warnings: Message[];
}

export interface PlanSummaryDto {
  days: number;
  avgEnergyKcal: number;
  avgProteinG: number;
  avgCarbsG: number;
  avgFatG: number;
  avgFiberG: number;
  workouts: number;
  trainingMinutes: number;
  restDays: number;
}

export interface GeneratedPlanDto {
  from: IsoDate;
  to: IsoDate;
  seed: number;
  /** Виды тренировок с ценой минуты — чтобы правку в плане было чем пересчитать. */
  workoutTypes: WorkoutTypeDto[];
  settings: GenerateRequest;
  /** Настройки после подстановки умолчаний — что на самом деле применилось. */
  resolved: { targets: TargetSettingsDto; algorithm: AlgorithmSettingsDto };
  targets: TargetsDto;
  days: PlanDayDto[];
  summary: PlanSummaryDto;
  /** Чего не удалось добиться — прямо, а не молчаливым «лучшим из плохих». */
  warnings: Message[];
}

export interface PlanDto {
  id: string;
  accountId: string;
  name: string;
  /** Свободные метки: «работа», «отпуск», «мягкий». Задаёт человек. */
  tags: string[];
  from: IsoDate;
  to: IsoDate;
  createdAt: string;
  plan: GeneratedPlanDto;
}

export interface PlanQuery {
  /** Поиск по названию, без учёта регистра. */
  search?: string;
  /** План должен нести все перечисленные метки. */
  tags?: string[];
  from?: IsoDate;
  to?: IsoDate;
  page?: number;
  pageSize?: number;
}

export interface SavePlanInput {
  name: string;
  tags?: string[];
  plan: GeneratedPlanDto;
}

export interface TemplateDto {
  id: string;
  /** У встроенных — двуязычный текст, у своих — то, что ввёл человек. */
  name: Text | string;
  description: Text | string;
  /** Встроенные приходят из кода и не удаляются. */
  builtin: boolean;
  settings: Partial<GenerateRequest>;
  createdAt: string | null;
}
