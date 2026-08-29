import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  BALANCE_EVEN_KCAL,
  MEALS,
  type BalanceState,
  type JournalDayDetailDto,
  type JournalDayDto,
  type JournalItemDto,
  type JournalMealDto,
  type JournalQuery,
  type JournalWorkoutDto,
  type PageDto,
} from '@fatoff/contracts';

import { ENTRIES_CTE, entriesParams } from '../../common/entries.sql';
import { Account } from '../../database/entities';
import { HEALTH_DAILY_CTE } from '../apple-health/health.sql';
import { EXERCISE_TARGET_MIN, STEPS_TARGET, scoreDay } from '../planner/day-score';
import { AccountFactsService } from '../planner/facts.service';
import { computeTargets } from '../planner/targets';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

interface ScoreTargets {
  proteinG: number | null;
  fiberG: number | null;
  steps: number;
  exerciseMin: number;
  leanMassKg: number | null;
}

/**
 * День, сведённый из обоих источников.
 *
 * YAZIO знает приход энергии, Apple Health — расход; ни одно из двух приложений
 * по отдельности баланса не показывает, и ради этой картины всё и делалось.
 *
 * Подробности дня — отдельный запрос: на трёх тысячах дней подгружать сразу все
 * приёмы пищи и все тренировки значит тянуть десятки тысяч строк ради двадцати
 * видимых. Строка дня при этом считается одним запросом на всю страницу, без N+1.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly em: EntityManager,
    private readonly facts: AccountFactsService,
  ) {}

  async days(accountId: string, query: JournalQuery): Promise<PageDto<JournalDayDto>> {
    const { from, to } = await this.range(accountId, query.from, query.to);
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)),
    );
    const offset = (page - 1) * pageSize;

    const columns: Record<string, string> = {
      date: 'date',
      balance: 'balance_kcal',
      energy: 'energy_kcal',
      steps: 'steps',
    };
    const column = columns[query.sort ?? 'date'] ?? 'date';
    const dir = query.dir === 'asc' ? 'asc' : 'desc';
    // вторичный ключ обязателен: без него страницы «плавают» между запросами
    const order = `order by ${column} ${dir} nulls last, date desc`;

    const params = [
      ...entriesParams(accountId, from, to),
      accountId, from, to, // health_daily
      accountId, from, to, // тренировки
      accountId, from, to, // сон
      accountId, from, to, // дни YAZIO
      accountId, from, to, // взвешивания
      pageSize,
      offset,
    ];

    const rows = await this.query<RawJournalRow>(
      `${ENTRIES_CTE},
       food as (
         select date,
                count(*)::int              as entries,
                count(distinct meal)::int  as meals,
                sum(energy_kcal)           as energy_kcal,
                sum(carbs_g)               as carbs_g,
                sum(protein_g)             as protein_g,
                sum(fat_g)                 as fat_g,
                sum(fiber_g)               as fiber_g
           from scaled group by date
       ),
       ${HEALTH_DAILY_CTE},
       workout as (
         select date, count(*)::int as workouts, sum(energy_kcal) as workout_kcal
           from health_workout
          where account_id = ? and date between ? and ?
          group by date
       ),
       night as (
         select distinct on (night) night, asleep_min
           from health_sleep
          where account_id = ? and night between ? and ?
          order by night, asleep_min desc
       ),
       diary as (
         select d.date,
                (d.water->>'water_intake')::float8 as water_ml,
                n.energy_goal
           from day_snapshot d
           left join daily_nutrients n on n.account_id = d.account_id and n.date = d.date
          where d.account_id = ? and d.date between ? and ?
       ),
       scale_weight as (
         select distinct on (date) date, value as weight_kg
           from body_value
          where account_id = ? and kind = 'weight' and date between ? and ?
          order by date, logged_at desc
       ),
       span as (
         select date from diary union select date from health
       ),
       joined as (
         select s.date,
                extract(isodow from s.date::date)::int as weekday,
                coalesce(f.entries, 0) as entries,
                coalesce(f.meals, 0)   as meals,
                f.energy_kcal, f.carbs_g, f.protein_g, f.fat_g, f.fiber_g,
                y.water_ml, y.energy_goal,
                h.steps, h.active_kcal, h.basal_kcal, h.exercise_min,
                coalesce(w.workouts, 0) as workouts, w.workout_kcal,
                n.asleep_min, sw.weight_kg,
                case when h.active_kcal is not null or h.basal_kcal is not null
                     then coalesce(h.active_kcal, 0) + coalesce(h.basal_kcal, 0) end as out_kcal
           from span s
           left join food         f  on f.date  = s.date
           left join diary        y  on y.date  = s.date
           left join health       h  on h.date  = s.date
           left join workout      w  on w.date  = s.date
           left join night        n  on n.night = s.date
           left join scale_weight sw on sw.date = s.date
       )
       select *, energy_kcal - out_kcal as balance_kcal, count(*) over () as total
         from joined
        ${where(query)}
        ${order}
        limit ? offset ?`,
      params,
    );

    const targets = await this.scoreTargets(accountId);

    return {
      items: rows.map((row) => this.toDay(row, targets)),
      total: Number(rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  async day(accountId: string, date: string): Promise<JournalDayDetailDto> {
    const [items, workouts, burn, targets] = await Promise.all([
      this.items(accountId, date),
      this.workouts(accountId, date),
      this.burn(accountId, date),
      this.scoreTargets(accountId),
    ]);

    const meals = groupByMeal(items);
    const food = sumOf(items);
    const workoutKcal = workouts.reduce((sum, workout) => sum + (workout.energyKcal ?? 0), 0);

    const score = scoreDay({
      energyInKcal: food.energyKcal,
      energyOutKcal: burn.totalKcal,
      proteinG: food.proteinG,
      fiberG: food.fiberG,
      steps: burn.steps,
      exerciseMin: burn.exerciseMin,
      asleepMin: burn.asleepMin,
      workoutKcal: workoutKcal || null,
      targets,
    });

    return {
      date,
      meals,
      workouts,
      burn: { ...burn.breakdown, workoutKcal: workoutKcal || null },
      score,
    };
  }

  // ── подробности ────────────────────────────────────────────────────────────

  private async items(
    accountId: string,
    date: string,
  ): Promise<Array<JournalItemDto & { meal: string }>> {
    const rows = await this.query<RawItemRow>(
      `${ENTRIES_CTE}
       select * from scaled order by logged_at, name`,
      entriesParams(accountId, date, date),
    );

    return rows.map((row) => ({
      meal: row.meal ?? 'snack',
      kind: row.kind as JournalItemDto['kind'],
      sourceId: row.source_id,
      name: row.name,
      producer: row.producer || null,
      amount: numeric(row.amount),
      unit: row.base_unit || null,
      serving: row.serving || null,
      loggedAt: row.logged_at,
      energyKcal: numeric(row.energy_kcal),
      carbsG: numeric(row.carbs_g),
      proteinG: numeric(row.protein_g),
      fatG: numeric(row.fat_g),
      fiberG: numeric(row.fiber_g),
    }));
  }

  private async workouts(accountId: string, date: string): Promise<JournalWorkoutDto[]> {
    const rows = await this.query<RawWorkoutRow>(
      `select started_at, type, duration_min, energy_kcal, distance_km, source
         from health_workout
        where account_id = ? and date = ?
        order by started_at`,
      [accountId, date],
    );

    return rows.map((row) => ({
      startedAt: row.started_at,
      type: row.type,
      durationMin: numeric(row.duration_min) ?? 0,
      energyKcal: numeric(row.energy_kcal),
      distanceKm: numeric(row.distance_km),
      source: row.source,
    }));
  }

  private async burn(
    accountId: string,
    date: string,
  ): Promise<{
    breakdown: JournalDayDetailDto['burn'];
    totalKcal: number | null;
    steps: number | null;
    exerciseMin: number | null;
    asleepMin: number | null;
  }> {
    const [row] = await this.query<RawBurnRow>(
      `with ${HEALTH_DAILY_CTE}
       select h.*, n.asleep_min
         from health h
         left join lateral (
           select asleep_min from health_sleep
            where account_id = ? and night = h.date
            order by asleep_min desc limit 1
         ) n on true`,
      [accountId, date, date, accountId],
    );

    const active = numeric(row?.active_kcal);
    const basal = numeric(row?.basal_kcal);
    const total = active !== null || basal !== null ? (active ?? 0) + (basal ?? 0) : null;

    return {
      breakdown: {
        basalKcal: basal,
        activeKcal: active,
        workoutKcal: null,
        totalKcal: total,
        steps: numeric(row?.steps),
        distanceKm: numeric(row?.distance_km),
        exerciseMin: numeric(row?.exercise_min),
        standHours: numeric(row?.stand_hours),
        restingHr: numeric(row?.resting_hr),
      },
      totalKcal: total,
      steps: numeric(row?.steps),
      exerciseMin: numeric(row?.exercise_min),
      asleepMin: numeric(row?.asleep_min),
    };
  }

  // ── общее ──────────────────────────────────────────────────────────────────

  /**
   * Цели, по которым оценивается день. Считаются один раз на запрос: от даты они
   * не зависят, а собирать их на каждую строку — тридцать лишних запросов на
   * страницу.
   */
  private async scoreTargets(accountId: string): Promise<ScoreTargets> {
    const targets = computeTargets(await this.facts.collect(accountId));
    return {
      proteinG: targets.computed.proteinG,
      fiberG: targets.computed.fiberG,
      steps: STEPS_TARGET,
      exerciseMin: EXERCISE_TARGET_MIN,
      leanMassKg: targets.profile.leanMassKg,
    };
  }

  private toDay(row: RawJournalRow, targets: ScoreTargets): JournalDayDto {
    const energyIn = numeric(row.energy_kcal);
    const out = numeric(row.out_kcal);
    const balance = numeric(row.balance_kcal);

    const score = scoreDay({
      energyInKcal: energyIn,
      energyOutKcal: out,
      proteinG: numeric(row.protein_g),
      fiberG: numeric(row.fiber_g),
      steps: numeric(row.steps),
      exerciseMin: numeric(row.exercise_min),
      asleepMin: numeric(row.asleep_min),
      workoutKcal: numeric(row.workout_kcal),
      targets,
    });

    return {
      date: row.date,
      weekday: Number(row.weekday),
      energyInKcal: energyIn,
      energyGoalKcal: numeric(row.energy_goal),
      carbsG: numeric(row.carbs_g),
      proteinG: numeric(row.protein_g),
      fatG: numeric(row.fat_g),
      fiberG: numeric(row.fiber_g),
      meals: Number(row.meals ?? 0),
      entries: Number(row.entries ?? 0),
      activeKcal: numeric(row.active_kcal),
      basalKcal: numeric(row.basal_kcal),
      energyOutKcal: out,
      steps: numeric(row.steps),
      workouts: Number(row.workouts ?? 0),
      workoutKcal: numeric(row.workout_kcal),
      exerciseMin: numeric(row.exercise_min),
      balanceKcal: balance,
      balance: balanceState(balance),
      asleepMin: numeric(row.asleep_min),
      waterMl: numeric(row.water_ml),
      weightKg: numeric(row.weight_kg),
      score: score.total,
    };
  }

  private query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.em.getConnection().execute<T[]>(sql, params);
  }

  /** Границы: весь период, о котором известно хоть одному из источников. */
  private async range(
    accountId: string,
    from?: string,
    to?: string,
  ): Promise<{ from: string; to: string }> {
    if (from && to) return { from, to };

    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const [bounds] = await this.query<{ date_from: string | null; date_to: string | null }>(
      `select least(d.min_date, h.min_date) as date_from,
              greatest(d.max_date, h.max_date) as date_to
         from (select min(date) as min_date, max(date) as max_date
                 from day_snapshot where account_id = ?) d
         cross join (select min(date) as min_date, max(date) as max_date
                       from health_daily where account_id = ?) h`,
      [accountId, accountId],
    );

    return {
      from: from ?? bounds?.date_from ?? '1970-01-01',
      to: to ?? bounds?.date_to ?? '2999-12-31',
    };
  }
}

/**
 * «Ноль» — коридор, а не точка: точность оценки YAZIO против оценки часов не
 * даёт права называть двенадцать килокалорий профицитом.
 */
function balanceState(balance: number | null): BalanceState | null {
  if (balance === null) return null;
  if (balance < -BALANCE_EVEN_KCAL) return 'deficit';
  if (balance > BALANCE_EVEN_KCAL) return 'surplus';
  return 'even';
}

/**
 * Отбор дней: пусто, еда, или обе половины сразу.
 *
 * «Обе половины» — это `entries > 0 and out_kcal is not null`: только там
 * известен и приход, и расход, а значит, у дня есть баланс. Ради него всё и
 * делалось, а без фильтра такие дни приходилось выискивать глазами среди
 * пустых.
 */
function where(query: { withFood?: boolean; withBalance?: boolean }): string {
  const conditions: string[] = [];
  if (query.withFood || query.withBalance) conditions.push('entries > 0');
  if (query.withBalance) conditions.push('out_kcal is not null');
  return conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
}

function groupByMeal(items: Array<JournalItemDto & { meal: string }>): JournalMealDto[] {
  const byMeal = new Map<string, JournalItemDto[]>();
  for (const { meal, ...item } of items) {
    const list = byMeal.get(meal) ?? [];
    list.push(item);
    byMeal.set(meal, list);
  }

  // порядок — как в дне, а не алфавитный; неизвестные приёмы уходят в хвост
  const order = [...MEALS] as string[];
  const keys = [...byMeal.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
  });

  return keys.map((meal) => {
    const list = byMeal.get(meal) ?? [];
    const totals = sumOf(list);
    return { meal, items: list, ...totals };
  });
}

/** Сумма по записям: если значения нет ни у одной, итог пуст, а не ноль. */
function sumOf(items: JournalItemDto[]): {
  energyKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
} {
  const add = (pick: (item: JournalItemDto) => number | null): number | null => {
    let sum = 0;
    let seen = false;
    for (const item of items) {
      const value = pick(item);
      if (value === null) continue;
      sum += value;
      seen = true;
    }
    return seen ? Math.round(sum * 10) / 10 : null;
  };

  return {
    energyKcal: add((item) => item.energyKcal),
    carbsG: add((item) => item.carbsG),
    proteinG: add((item) => item.proteinG),
    fatG: add((item) => item.fatG),
    fiberG: add((item) => item.fiberG),
  };
}

/** PostgreSQL отдаёт float8 строкой; отсутствующее значение остаётся пустым, а не нулём. */
function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 10) / 10 : null;
}

interface RawJournalRow {
  total: string | number;
  date: string;
  weekday: string | number;
  entries: string | number;
  meals: string | number;
  energy_kcal: string | null;
  carbs_g: string | null;
  protein_g: string | null;
  fat_g: string | null;
  fiber_g: string | null;
  water_ml: string | null;
  energy_goal: string | null;
  steps: string | null;
  active_kcal: string | null;
  basal_kcal: string | null;
  exercise_min: string | null;
  workouts: string | number;
  workout_kcal: string | null;
  asleep_min: string | null;
  weight_kg: string | null;
  out_kcal: string | null;
  balance_kcal: string | null;
}

interface RawItemRow {
  date: string;
  logged_at: string;
  meal: string | null;
  kind: string;
  source_id: string | null;
  amount: string | null;
  serving: string | null;
  name: string;
  producer: string | null;
  base_unit: string | null;
  energy_kcal: string | null;
  carbs_g: string | null;
  protein_g: string | null;
  fat_g: string | null;
  fiber_g: string | null;
}

interface RawWorkoutRow {
  started_at: string;
  type: string;
  duration_min: string | null;
  energy_kcal: string | null;
  distance_km: string | null;
  source: string | null;
}

interface RawBurnRow {
  date: string;
  steps: string | null;
  active_kcal: string | null;
  basal_kcal: string | null;
  exercise_min: string | null;
  stand_hours: string | null;
  distance_km: string | null;
  resting_hr: string | null;
  asleep_min: string | null;
}
