import {
  BALANCE_EVEN_KCAL,
  message,
  type Message,
  MAIN_MEALS,
  MEALS,
  type AlgorithmSettingsDto,
  type BalanceState,
  type PinnedDto,
  type PlannedWorkoutDto,
  type MacroSetDto,
  type MealKey,
  type PlanDayDto,
  type PlanSummaryDto,
  type PlannedMealDto,
  type PoolItemDto,
  type TargetSettingsDto,
  type TargetsDto,
} from '@fatoff/contracts';

import { EA_THRESHOLD, dayTargets } from './targets';
import {
  makeRng,
  selectMeal,
  toPlannedMeal,
  zero,
  type MealSelection,
  type MealTarget,
  type Totals,
} from './menu-generator';
import { isoWeekday, type TrainingPlan } from './training-plan';

/**
 * Сборка периода: тренировки, цели дня, меню, проверки.
 *
 * Порядок не случаен. Сначала расставляются тренировки, потому что от них
 * зависит целевая калорийность дня; только потом подбирается еда. Наоборот не
 * получится: в день с часовой пробежкой дефицит без прибавки удваивается, и
 * именно это роняет энергодоступность (docs/ANALYSIS-NUTRITION.md, § 2.3).
 */

/** Ниже этой доли от нормы клетчатки включается доводка. */
const FIBER_REPAIR_FLOOR = 0.9;
/** Во столько раз поднимается вес клетчатки при доводке. */
const FIBER_REPAIR_BOOST = 4;

export interface BuildPlanInput {
  dates: string[];
  targets: TargetsDto;
  targetSettings: TargetSettingsDto;
  algorithm: AlgorithmSettingsDto;
  meals: MealKey[];
  pool: PoolItemDto[];
  training: TrainingPlan;
  pinned?: PinnedDto[];
  seed: number;
}

export interface BuiltPlan {
  days: PlanDayDto[];
  summary: PlanSummaryDto;
  warnings: Message[];
}

export function buildPlan(input: BuildPlanInput): BuiltPlan {
  const rng = makeRng(input.seed);
  const warnings: Message[] = [...input.training.notes];
  const meals = input.meals.length > 0 ? input.meals : [...MEALS];
  const shares = normalizeShares(meals, input.targetSettings);
  const leanMass = input.targets.profile.leanMassKg;

  if (input.pool.length === 0) {
    warnings.push(message('plan.empty-pool'));
  }

  /** Что уже съедено за последние дни — окно разнообразия скользит по датам. */
  const history: Array<{ date: string; keys: string[] }> = [];
  const days: PlanDayDto[] = [];

  for (const date of input.dates) {
    const workouts = input.training.byDate.get(date) ?? [];
    const workoutKcal = workouts.reduce((sum, workout) => sum + workout.energyKcal, 0);
    const targets = dayTargets(input.targets.computed, input.targetSettings, workoutKcal);

    const used = usedWithin(history, date, input.algorithm.varietyWindowDays);
    const selections: MealSelection[] = [];
    const mealTargets: MealTarget[] = [];

    for (const meal of meals) {
      const target = mealTargetFor(meal, targets, shares[meal] ?? 0, input.targets.proteinPerMealG);
      const selection = selectMeal(
        target,
        input.pool,
        input.algorithm,
        used,
        rng,
        pinnedFor(input.pinned, input.pool, date, meal),
      );

      mealTargets.push(target);
      selections.push(selection);
      for (const chosen of selection.items) {
        used.set(chosen.item.key, (used.get(chosen.item.key) ?? 0) + 1);
      }
    }

    repairFiber(selections, mealTargets, targets, input, used, rng);

    days.push(
      assembleDay({
        date,
        selections,
        mealTargets,
        targets,
        workouts,
        workoutKcal,
        leanMass,
        burn: {
          basalKcal: input.targets.expenditure.basalKcal,
          activeWithoutWorkoutsKcal: input.targets.expenditure.activeWithoutWorkoutsKcal,
        },
      }),
    );

    history.push({ date, keys: selections.flatMap((s) => s.items.map((i) => i.item.key)) });
  }

  return { days, summary: summarize(days), warnings };
}

/** Из чего складывается прикидка расхода дня, кроме самих тренировок. */
export interface BurnFacts {
  basalKcal: number | null;
  activeWithoutWorkoutsKcal: number | null;
}

export interface AssembleInput {
  date: string;
  selections: MealSelection[];
  mealTargets: MealTarget[];
  targets: MacroSetDto;
  workouts: PlannedWorkoutDto[];
  workoutKcal: number;
  leanMass: number | null;
  burn: BurnFacts;
}

/**
 * Сборка дня из уже выбранных приёмов пищи: итоги, энергодоступность, замечания.
 *
 * Вынесено отдельно, потому что тем же кодом считается день после ручной правки
 * — заменили блюдо или поменяли граммовку. Держать две версии этой арифметики
 * значило бы получить два разных ответа на один вопрос.
 */
export function assembleDay(input: AssembleInput): PlanDayDto {
  const { selections, mealTargets, targets, workoutKcal, leanMass } = input;
  const totals = totalsOf(selections);
  const warnings: Message[] = selections.flatMap((selection) => selection.shortfalls);

  if (targets.fiberG !== null && totals.fiber < targets.fiberG * FIBER_REPAIR_FLOOR) {
    warnings.push(
      message('day.low-fiber', { actual: totals.fiber.toFixed(1), target: targets.fiberG }),
    );
  }

  const availability = leanMass ? round((totals.energy - workoutKcal) / leanMass, 1) : null;
  if (availability !== null && availability < EA_THRESHOLD) {
    warnings.push(
      message('day.low-energy-availability', { value: availability, threshold: EA_THRESHOLD }),
    );
  }

  /*
   * Расход будущего дня точно не посчитать: часы его ещё не измерили. Но
   * ориентир получить можно — базальный обмен у неё изо дня в день почти не
   * меняется, обычное движение тоже, а запланированные занятия известны.
   */
  const { basalKcal, activeWithoutWorkoutsKcal } = input.burn;
  const burnKcal =
    basalKcal === null && activeWithoutWorkoutsKcal === null
      ? null
      : round((basalKcal ?? 0) + (activeWithoutWorkoutsKcal ?? 0) + workoutKcal);
  const balanceKcal = burnKcal === null ? null : round(totals.energy - burnKcal);

  return {
    date: input.date,
    weekday: isoWeekday(input.date),
    targets,
    totals: {
      energyKcal: round(totals.energy),
      proteinG: round(totals.protein, 1),
      carbsG: round(totals.carbs, 1),
      fatG: round(totals.fat, 1),
      fiberG: round(totals.fiber, 1),
    },
    meals: selections.map((selection, index) => toPlannedMeal(selection, mealTargets[index])),
    workouts: input.workouts,
    workoutKcal,
    burnKcal,
    balanceKcal,
    balance: balanceState(balanceKcal),
    energyAvailability: availability,
    warnings,
  };
}

/** «Ровно» — коридор, а не точка: прикидка расхода точнее сотни килокалорий не бывает. */
function balanceState(balance: number | null): BalanceState | null {
  if (balance === null) return null;
  if (balance < -BALANCE_EVEN_KCAL) return 'deficit';
  if (balance > BALANCE_EVEN_KCAL) return 'surplus';
  return 'even';
}

/** Закреплённые блюда этого дня и приёма: без даты — во все дни периода. */
function pinnedFor(
  pinned: PinnedDto[] | undefined,
  pool: PoolItemDto[],
  date: string,
  meal: MealKey,
): Array<{ item: PoolItemDto; amount: number }> {
  if (!pinned || pinned.length === 0) return [];

  const chosen: Array<{ item: PoolItemDto; amount: number }> = [];
  for (const entry of pinned) {
    if (entry.meal !== meal) continue;
    if (entry.date && entry.date !== date) continue;

    const item = pool.find((candidate) => candidate.key === entry.key);
    if (!item) continue;
    if (chosen.some((already) => already.item.key === item.key)) continue;
    chosen.push({ item, amount: entry.amount ?? item.typicalAmount });
  }
  return chosen;
}

/**
 * Цель приёма пищи.
 *
 * Калории — доля дня; макросы — та же доля, но белок у основных приёмов не
 * опускается ниже порога 0.4 г/кг, даже если по доле выходит меньше. Суточной
 * суммы белка мало: важно, чтобы каждый приём давал полноценный отклик.
 */
export function mealTargetFor(
  meal: MealKey,
  targets: MacroSetDto,
  share: number,
  proteinFloor: number | null,
): MealTarget {
  const floor = proteinFloor !== null && MAIN_MEALS.includes(meal) ? proteinFloor : 0;
  return {
    meal,
    energyKcal: (targets.energyKcal ?? 0) * share,
    proteinG: Math.max((targets.proteinG ?? 0) * share, floor),
    carbsG: (targets.carbsG ?? 0) * share,
    fatG: (targets.fatG ?? 0) * share,
    fiberG: (targets.fiberG ?? 0) * share,
    proteinFloorG: floor,
  };
}

/**
 * Доводка по клетчатке.
 *
 * Самый заметный разрыв в её питании — 8 г против 20 (§ 2.2 анализа), и одним
 * весом в оценке он не закрывается: клетчатка обычно проигрывает калориям.
 * Поэтому, если день недобрал, приём с наибольшим недобором пересобирается с
 * поднятым весом клетчатки, и новый вариант принимается только если день
 * действительно стал ближе к норме.
 */
function repairFiber(
  selections: MealSelection[],
  targets: MealTarget[],
  dayTarget: MacroSetDto,
  input: BuildPlanInput,
  used: Map<string, number>,
  rng: () => number,
): void {
  const want = dayTarget.fiberG;
  if (want === null || want <= 0) return;

  const before = totalsOf(selections).fiber;
  if (before >= want * FIBER_REPAIR_FLOOR) return;

  const index = selections.reduce(
    (worst, selection, i) =>
      targets[i].fiberG - selection.totals.fiber > targets[worst].fiberG - selections[worst].totals.fiber
        ? i
        : worst,
    0,
  );

  const boosted: AlgorithmSettingsDto = {
    ...input.algorithm,
    weights: { ...input.algorithm.weights, fiber: input.algorithm.weights.fiber * FIBER_REPAIR_BOOST },
  };

  // прежний выбор не должен мешать сам себе: считаем повторы без него
  const without = new Map(used);
  for (const chosen of selections[index].items) {
    const count = (without.get(chosen.item.key) ?? 1) - 1;
    if (count > 0) without.set(chosen.item.key, count);
    else without.delete(chosen.item.key);
  }

  const retry = selectMeal(targets[index], input.pool, boosted, without, rng);
  const after = totalsOf([...selections.slice(0, index), retry, ...selections.slice(index + 1)]);
  const tolerance = (targets[index].energyKcal * input.algorithm.energyTolerancePct) / 100;

  const better =
    after.fiber > before &&
    Math.abs(retry.totals.energy - targets[index].energyKcal) <= Math.max(tolerance, 1);

  if (better) {
    for (const chosen of selections[index].items) {
      const count = (used.get(chosen.item.key) ?? 1) - 1;
      if (count > 0) used.set(chosen.item.key, count);
      else used.delete(chosen.item.key);
    }
    for (const chosen of retry.items) used.set(chosen.item.key, (used.get(chosen.item.key) ?? 0) + 1);
    selections[index] = retry;
  }
}

/** Доли приёмов пищи, нормированные на выбранный набор: сумма всегда единица. */
export function normalizeShares(meals: MealKey[], settings: TargetSettingsDto): Record<string, number> {
  const total = meals.reduce((sum, meal) => sum + (settings.mealShares[meal] ?? 0), 0);
  const shares: Record<string, number> = {};

  for (const meal of meals) {
    shares[meal] = total > 0 ? (settings.mealShares[meal] ?? 0) / total : 1 / meals.length;
  }
  return shares;
}

/** Повторы в окне: сколько раз каждый продукт встречался за последние дни. */
function usedWithin(
  history: Array<{ date: string; keys: string[] }>,
  date: string,
  windowDays: number,
): Map<string, number> {
  const used = new Map<string, number>();
  const from = shiftDate(date, -(windowDays - 1));

  for (const day of history) {
    if (day.date < from) continue;
    for (const key of day.keys) used.set(key, (used.get(key) ?? 0) + 1);
  }
  return used;
}

function totalsOf(selections: MealSelection[]): Totals {
  const totals = zero();
  for (const selection of selections) {
    totals.energy += selection.totals.energy;
    totals.protein += selection.totals.protein;
    totals.carbs += selection.totals.carbs;
    totals.fat += selection.totals.fat;
    totals.fiber += selection.totals.fiber;
  }
  return totals;
}

function summarize(days: PlanDayDto[]): PlanSummaryDto {
  const count = Math.max(1, days.length);
  const avg = (pick: (day: PlanDayDto) => number | null): number =>
    round(days.reduce((sum, day) => sum + (pick(day) ?? 0), 0) / count, 1);

  const workouts = days.reduce((sum, day) => sum + day.workouts.length, 0);
  const minutes = days.reduce(
    (sum, day) => sum + day.workouts.reduce((inner, workout) => inner + workout.durationMin, 0),
    0,
  );

  return {
    days: days.length,
    avgEnergyKcal: round(days.reduce((sum, day) => sum + (day.totals.energyKcal ?? 0), 0) / count),
    avgProteinG: avg((day) => day.totals.proteinG),
    avgCarbsG: avg((day) => day.totals.carbsG),
    avgFatG: avg((day) => day.totals.fatG),
    avgFiberG: avg((day) => day.totals.fiberG),
    workouts,
    trainingMinutes: minutes,
    restDays: days.filter((day) => day.workouts.length === 0).length,
  };
}

/** Все меню периода — они же используются, когда план показывают одной таблицей. */
export function flattenMeals(days: PlanDayDto[]): PlannedMealDto[] {
  return days.flatMap((day) => day.meals);
}

function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
