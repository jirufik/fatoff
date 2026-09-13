import {
  FULL_DAY_MEALS,
  MEALS,
  balanceZone,
  workoutGroup,
  type HomeBalanceDto,
  type HomeMealDto,
  type HomeWeekDto,
  type MacroSetDto,
} from '@fatoff/contracts';

import { addDays, weekStart } from '../../common/date.util';
import { WHO_CARDIO_MIN, WHO_STRENGTH_DAYS } from '../planner/training-plan';

/**
 * Главный экран — чистые функции (D-083).
 *
 * Сервис достаёт строки, здесь из них собирается то, что видит человек: баланс
 * последнего полного дня, питание за сегодня и неделя тренировок против нормы.
 */

/** Итоги дня: еда из дневника, расход из Apple Health. */
export interface BalanceRow {
  date: string;
  meals: number;
  eatenKcal: number | null;
  activeKcal: number | null;
  basalKcal: number | null;
}

/**
 * Баланс последнего полного дня.
 *
 * Полный — известны еда и расход, и записано не меньше трёх приёмов пищи: тот же
 * порог, что у отбора «с едой и расходом» (D-078). Сегодняшнее утро с одним
 * завтраком против расхода за сутки показало бы огромный дефицит, которого не
 * было, — поэтому сегодня попадает сюда, только когда записано целиком.
 *
 * `completeTo` — последний день, за который расход известен целиком (см.
 * `completeToOf`): день сборки выгрузки полным не бывает, как его ни записывай.
 */
export function lastFullDay(
  rows: BalanceRow[],
  completeTo: string | null = null,
): HomeBalanceDto | null {
  const day = rows
    .filter(
      (row) =>
        (completeTo === null || row.date <= completeTo) &&
        row.eatenKcal !== null &&
        row.meals >= FULL_DAY_MEALS &&
        (row.activeKcal !== null || row.basalKcal !== null),
    )
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  if (!day) return null;

  const burned = (day.activeKcal ?? 0) + (day.basalKcal ?? 0);
  // округляется так же, как строка дня в журнале: зона по тому же числу, что на экране
  const balance = round(day.eatenKcal! - burned);

  return {
    date: day.date,
    eatenKcal: round(day.eatenKcal!),
    burnedKcal: round(burned),
    activeKcal: day.activeKcal === null ? null : round(day.activeKcal),
    basalKcal: day.basalKcal === null ? null : round(day.basalKcal),
    balanceKcal: balance,
    zone: balanceZone(balance),
  };
}

/**
 * По какой день расход известен целиком.
 *
 * Выгрузку Apple Health собирают посреди дня, и этот день в ней обрезан на часе
 * сборки: к трём часам дня базового обмена набирается едва больше половины
 * суточного. Рядом с целым днём еды такой день выглядит профицитом, которого не
 * было. Поэтому целиком известен только день перед сборкой — если за день сборки
 * данные вообще есть. Следующая выгрузка этот день допишет (D-084).
 */
export function completeToOf(exportedAt: string | null, dataTo: string | null): string | null {
  if (dataTo === null) return null;
  const exportDay = exportedAt?.slice(0, 10) ?? null;
  return exportDay !== null && exportDay <= dataTo ? addDays(exportDay, -1) : dataTo;
}

/** Итоги приёма пищи за день. */
export interface MealRow {
  meal: string;
  entries: number;
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
}

/**
 * Питание за день по приёмам.
 *
 * Порядок — как в дне, а не алфавитный; итог, у которого нет ни одного значения,
 * остаётся пустым: YAZIO не присылает нутриент, о котором не знает, и ноль на его
 * месте был бы выдумкой.
 */
export function foodOfDay(rows: MealRow[]): {
  entries: number;
  eaten: MacroSetDto;
  meals: HomeMealDto[];
} {
  const rank = (meal: string): number => {
    const index = (MEALS as readonly string[]).indexOf(meal);
    return index < 0 ? MEALS.length : index;
  };
  const add = (pick: (row: MealRow) => number | null): number | null => {
    let total = 0;
    let seen = false;
    for (const row of rows) {
      const value = pick(row);
      if (value === null) continue;
      total += value;
      seen = true;
    }
    return seen ? round(total) : null;
  };

  return {
    entries: rows.reduce((total, row) => total + row.entries, 0),
    eaten: {
      energyKcal: add((row) => row.energyKcal),
      proteinG: add((row) => row.proteinG),
      carbsG: add((row) => row.carbsG),
      fatG: add((row) => row.fatG),
      fiberG: add((row) => row.fiberG),
    },
    meals: [...rows]
      .sort((left, right) => rank(left.meal) - rank(right.meal))
      .map((row) => ({
        meal: row.meal,
        energyKcal: row.energyKcal === null ? null : round(row.energyKcal),
      })),
  };
}

/** Тренировка из Apple Health. */
export interface WorkoutRow {
  date: string;
  type: string;
  durationMin: number;
  energyKcal: number | null;
}

/**
 * Неделя тренировок против нормы ВОЗ.
 *
 * Неделя — с понедельника: норма недельная, и «цель выполнена» должна
 * начинаться заново, а не скользить вместе с календарём.
 *
 * Если часы не известны ни за один день этой недели, числа пустые, а не нули:
 * выгрузка Apple Health приезжает с опозданием, и «ещё не приехало» — это не
 * «не тренировалась».
 */
export function trainingWeek(
  today: string,
  workouts: WorkoutRow[],
  knownTo: string | null,
): HomeWeekDto {
  const from = weekStart(today);
  const to = addDays(from, 6);
  const strengthGoal = WHO_STRENGTH_DAYS;
  const cardioGoal = WHO_CARDIO_MIN[0];

  if (knownTo === null || knownTo < from) {
    return {
      from,
      to,
      knownTo,
      strength: { count: null, goal: strengthGoal },
      cardio: { minutes: null, count: null, goal: cardioGoal },
      workouts: null,
      minutes: null,
      energyKcal: null,
    };
  }

  const week = workouts.filter((workout) => workout.date >= from && workout.date <= to);
  const strength = week.filter((workout) => workoutGroup(workout.type) === 'strength');
  const cardio = week.filter((workout) => workoutGroup(workout.type) === 'cardio');
  const withEnergy = week.filter((workout) => workout.energyKcal !== null);
  const minutes = (list: WorkoutRow[]): number =>
    Math.round(list.reduce((total, workout) => total + workout.durationMin, 0));

  return {
    from,
    to,
    knownTo,
    // ВОЗ считает силовые дни, а не занятия: две силовые в один день — один день
    strength: { count: new Set(strength.map((workout) => workout.date)).size, goal: strengthGoal },
    // а кардио — минутами: прогулка на полтора часа и на пятнадцать минут — разное
    cardio: { minutes: minutes(cardio), count: cardio.length, goal: cardioGoal },
    workouts: week.length,
    minutes: minutes(week),
    energyKcal:
      week.length === 0
        ? 0
        : withEnergy.length === 0
          ? null
          : Math.round(withEnergy.reduce((total, workout) => total + workout.energyKcal!, 0)),
  };
}

/**
 * Имя для приветствия — из профиля YAZIO.
 *
 * Не имя аккаунта: его человек задаёт для списка аккаунтов, и там бывает
 * «основной» или «дневник жены» — приветствовать так нельзя.
 */
export function firstNameOf(profile: Record<string, unknown> | null | undefined): string | null {
  const value = profile?.first_name;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
