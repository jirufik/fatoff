import { dateRange } from '../../../common/date.util';
import type { ExportSource } from '../source';
import { TableBuilder, join, num, str, type Table } from '../table';

/**
 * Цели дня в двух вариантах: `effective` — то, по чему считался день,
 * `unmodified` — то, что предлагал YAZIO до ручных правок. Ключи целей приходят
 * через точку, поэтому берутся по именам, а не по позиции.
 */
export function dailyGoalsTable(source: ExportSource): Table {
  const builder = new TableBuilder('daily_goals', [
    'date',
    'variant',
    'energy_kcal',
    'carbs_g',
    'protein_g',
    'fat_g',
    'water_ml',
    'steps',
    'weight_kg',
  ]);

  for (const date of dateRange(source.from, source.to)) {
    const day = source.days.get(date);
    if (!day) continue;

    const variants: Array<[string, Record<string, number> | null]> = [
      ['effective', day.goals],
      ['unmodified', day.goalsUnmodified],
    ];

    for (const [variant, goals] of variants) {
      if (!goals || Object.keys(goals).length === 0) continue;
      builder.push([
        date,
        variant,
        num(goals['energy.energy']),
        num(goals['nutrient.carb']),
        num(goals['nutrient.protein']),
        num(goals['nutrient.fat']),
        num(goals.water),
        num(goals['activity.step']),
        num(goals['bodyvalue.weight']),
      ]);
    }
  }

  return builder.finish();
}

/**
 * Дневная активность и залогированные тренировки.
 *
 * Шаги, длительность и энергия берутся из диапазонного ответа — он авторитетнее
 * и дешевле, — а дистанция и происхождение только в дневном.
 */
export function activityTables(source: ExportSource): { daily: Table; workouts: Table } {
  const daily = new TableBuilder('daily_activity', [
    'date',
    'steps',
    'activity_energy_kcal',
    'distance_m',
    'duration_min',
    'source',
    'gateway',
  ]);

  const workouts = new TableBuilder('exercises', [
    'date',
    'kind',
    'exercise_id',
    'name',
    'note',
    'energy_kcal',
    'duration_min',
    'distance_m',
    'steps',
    'source',
    'gateway',
  ]);

  for (const date of dateRange(source.from, source.to)) {
    const range = source.dailyExercise.get(date);
    const log = source.days.get(date)?.exercises ?? null;
    const activity = log?.activity ?? null;
    if (!range && !activity) continue;

    daily.push([
      date,
      num(range?.steps ?? activity?.steps),
      num(range?.energy ?? activity?.energy),
      num(activity?.distance),
      num(range?.duration ?? activity?.duration),
      str(activity?.source),
      str(activity?.gateway),
    ]);

    if (!log) continue;
    const sessions = [
      ...(log.training ?? []).map((t) => ['training', t] as const),
      ...(log.custom_training ?? []).map((t) => ['custom_training', t] as const),
    ];

    for (const [kind, session] of sessions) {
      workouts.push([
        date,
        kind,
        str(session.id),
        str(session.name),
        str(session.note),
        num(session.energy),
        num(session.duration),
        num(session.distance),
        num(session.steps),
        str(session.source),
        str(session.gateway),
      ]);
    }
  }

  return { daily: daily.finish(), workouts: workouts.finish() };
}

export function feelingsTable(source: ExportSource): Table {
  const builder = new TableBuilder('feelings', ['date', 'note', 'tags']);

  for (const date of dateRange(source.from, source.to)) {
    const feeling = source.days.get(date)?.feeling;
    if (!feeling) continue;
    // пустая запись — это «спросили и ничего не нашли», строки она не заслуживает
    if (!feeling.note && (feeling.tags ?? []).length === 0) continue;

    builder.push([date, str(feeling.note), join(feeling.tags)]);
  }

  return builder.finish();
}

/**
 * Серия ведения дневника. Эндпоинт отдаёт календарь всего аккаунта, а в таблицу
 * идут только даты периода — иначе она не соединяется с остальными.
 */
export function streakTable(source: ExportSource): Table {
  const builder = new TableBuilder('streak', ['date', 'daytimes', 'origin_of_recovery']);
  const inRange = new Set(dateRange(source.from, source.to));

  for (const date of Object.keys(source.streak).sort()) {
    if (!inRange.has(date)) continue;
    const day = source.streak[date];
    builder.push([date, join(day.daytimes), str(day.origin_of_recovery)]);
  }

  return builder.finish();
}
