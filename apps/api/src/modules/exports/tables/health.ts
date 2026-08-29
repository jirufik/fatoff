import { dateRange } from '../../../common/date.util';
import type { ExportSource } from '../source';
import { TableBuilder, num, str, type Table } from '../table';
import { totalsBy, type DiaryEntry } from './diary';

/**
 * Таблицы Apple Health и — главное — сведение с YAZIO.
 *
 * Значения приходят уже дедуплицированными: на каждый день и тип оставлен один
 * источник. Складывать часы с телефоном нельзя, см. `docs/APPLE-HEALTH.md`, § 2.1.
 */

export function healthDailyTable(source: ExportSource): Table {
  const builder = new TableBuilder('health_daily', [
    'date',
    'steps',
    'active_energy_kcal',
    'basal_energy_kcal',
    'exercise_min',
    'stand_hours',
    'distance_km',
    'flights_climbed',
    'resting_heart_rate',
    'heart_rate_avg',
    'hrv_ms',
    'respiratory_rate',
    'oxygen_saturation',
    'weight_kg',
  ]);

  const health = source.health;
  if (!health) return builder.finish();

  for (const date of dateRange(source.from, source.to)) {
    const day = health.days.get(date);
    if (!day) continue;

    builder.push([
      date,
      num(day.steps),
      num(day.activeKcal),
      num(day.basalKcal),
      num(day.exerciseMin),
      num(day.standHours),
      num(day.distanceKm),
      num(day.flights),
      num(day.restingHr),
      num(day.heartRateAvg),
      num(day.hrvMs),
      num(day.respiratoryRate),
      num(day.oxygenSaturation),
      num(day.weightKg),
    ]);
  }

  return builder.finish();
}

export function healthWorkoutsTable(source: ExportSource): Table {
  const builder = new TableBuilder('health_workouts', [
    'date',
    'started_at',
    'type',
    'duration_min',
    'energy_kcal',
    'distance_km',
    'source',
  ]);

  for (const workout of source.health?.workouts ?? []) {
    builder.push([
      workout.date,
      workout.startedAt,
      workout.type,
      num(workout.durationMin),
      num(workout.energyKcal),
      num(workout.distanceKm),
      str(workout.source),
    ]);
  }

  return builder.finish();
}

export function healthSleepTable(source: ExportSource): Table {
  const builder = new TableBuilder('health_sleep', [
    'night',
    'source',
    'in_bed_min',
    'asleep_min',
    'deep_min',
    'rem_min',
    'core_min',
    'awake_min',
    'fell_asleep_at',
    'woke_at',
  ]);

  const nights = [...(source.health?.sleep.values() ?? [])].sort((a, b) =>
    a.night.localeCompare(b.night),
  );

  for (const night of nights) {
    builder.push([
      night.night,
      night.source,
      num(night.inBedMin),
      num(night.asleepMin),
      num(night.deepMin),
      num(night.remMin),
      num(night.coreMin),
      num(night.awakeMin),
      str(night.fellAsleepAt),
      str(night.wokeAt),
    ]);
  }

  return builder.finish();
}

/**
 * День, сведённый из обоих источников — ради этой таблицы всё и делалось.
 *
 * YAZIO знает приход энергии, Apple Health — расход; ни одно из двух приложений
 * по отдельности баланса не показывает. Баланс считается только там, где есть
 * обе половины: приход без расхода — не баланс, а половина ответа.
 *
 * Вес намеренно двумя колонками: это два независимых измерения, и расхождение
 * между ними само по себе о чём-то говорит.
 */
export function combinedDailyTable(source: ExportSource, entries: DiaryEntry[]): Table {
  const builder = new TableBuilder('daily_combined', [
    'date',
    'energy_in_kcal',
    'energy_goal_kcal',
    'carbs_g',
    'protein_g',
    'fat_g',
    'fiber_g',
    'water_ml',
    'active_energy_kcal',
    'basal_energy_kcal',
    'energy_out_kcal',
    'balance_kcal',
    'steps',
    'exercise_min',
    'asleep_min',
    'deep_min',
    'resting_heart_rate',
    'weight_yazio_kg',
    'weight_health_kg',
  ]);

  const health = source.health;
  const computed = totalsBy(entries, (entry) => entry.date);

  // вес из YAZIO: последнее взвешивание за день
  const yazioWeight = new Map<string, number>();
  for (const value of source.bodyValues
    .filter((row) => row.kind === 'weight')
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))) {
    yazioWeight.set(value.date, value.value);
  }

  for (const date of dateRange(source.from, source.to)) {
    const totals = source.dailyNutrients.get(date);
    const day = health?.days.get(date);
    const night = health?.sleep.get(date);
    const water = source.days.get(date)?.water;

    const active = day?.activeKcal ?? null;
    const basal = day?.basalKcal ?? null;
    const out = active !== null || basal !== null ? (active ?? 0) + (basal ?? 0) : null;
    const inKcal = totals?.energy ?? null;
    const balance = inKcal !== null && out !== null ? inKcal - out : null;

    // строка только там, где есть хоть что-то: пустые дни ничего не добавляют
    if (totals === undefined && day === undefined && night === undefined) continue;

    builder.push([
      date,
      num(inKcal),
      num(totals?.energyGoal),
      num(totals?.carb),
      num(totals?.protein),
      num(totals?.fat),
      num(computed.get(date)?.nutrients.display('nutrient.dietaryfiber')),
      num(water ? (water.water_intake ?? 0) : null),
      num(active),
      num(basal),
      num(out),
      num(balance),
      num(day?.steps),
      num(day?.exerciseMin),
      num(night?.asleepMin),
      num(night?.deepMin),
      num(day?.restingHr),
      num(yazioWeight.get(date)),
      num(day?.weightKg),
    ]);
  }

  return builder.finish();
}
