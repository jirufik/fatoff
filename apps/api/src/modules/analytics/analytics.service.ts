import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  HOME_BALANCE_WINDOW_DAYS,
  type AccountOverviewDto,
  type AccountSyncStatus,
  type DailyPointDto,
  type HomeDto,
  type PeriodSummaryDto,
} from '@fatoff/contracts';

import {
  addDays,
  assertIsoDate,
  dateRange,
  isIsoDate,
  today as todayOf,
  weekStart,
} from '../../common/date.util';
import { ENTRIES_CTE, entriesParams } from '../../common/entries.sql';
import {
  Account,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  HealthImport,
  ProductCache,
  RecipeCache,
  SyncRun,
} from '../../database/entities';
import { HEALTH_DAILY_CTE } from '../apple-health/health.sql';
import { AccountFactsService } from '../planner/facts.service';
import { computeTargets } from '../planner/targets';

import {
  completeToOf,
  firstNameOf,
  foodOfDay,
  lastFullDay,
  trainingWeek,
  type BalanceRow,
  type MealRow,
  type WorkoutRow,
} from './home';
import { ACTIVITY_BASELINE_DAYS, analyzePeriod, summarizePeriod, type PeriodRow } from './period';

/** Типы Apple Health, по которым видно, что часы за день известны. */
const WATCH_TYPES = `'ActiveEnergyBurned', 'BasalEnergyBurned', 'StepCount'`;

/**
 * Главный экран и сводка за период.
 *
 * Сервис только достаёт строки: всё, что из них следует, считают чистые функции
 * в `period.ts` и `home.ts`. Разбор дневника и свёртка Apple Health — те же, что
 * у журнала дня: вторая арифметика дала бы на главном экране одно число, а на
 * «Дне целиком» другое.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly em: EntityManager,
    private readonly facts: AccountFactsService,
  ) {}

  /**
   * Сводка за период: расход, съеденное, что из этого вышло — и выводы словами.
   *
   * Среднее берётся по дням, где данные есть, а не по всем дням периода. День,
   * когда часы остались на тумбочке, — это «не знаем», а не «не двигалась»; в
   * среднем он занижал бы расход и превращал бы забытые часы в упадок сил.
   * Сколько дней попало в счёт, едет наружу рядом с числом (D-082).
   *
   * Итоги, ряд для графика и анализ считаются из одних и тех же строк по дням:
   * посчитанные тремя запросами, они однажды разошлись бы между собой.
   */
  async summary(accountId: string, from?: string, to?: string): Promise<PeriodSummaryDto> {
    const rangeTo = assertIsoDate(to ?? todayOf(), 'Конец периода');
    const rangeFrom = assertIsoDate(from ?? addDays(rangeTo, -6), 'Начало периода');
    if (rangeFrom > rangeTo) throw new Error(`Начало периода ${rangeFrom} позже конца ${rangeTo}`);

    const [rows, facts, baseline] = await Promise.all([
      this.periodRows(accountId, rangeFrom, rangeTo),
      this.facts.collect(accountId),
      this.baselineSteps(accountId, rangeFrom),
    ]);

    const summary = summarizePeriod(rows, rangeFrom, rangeTo);
    return {
      ...summary,
      analysis: analyzePeriod({
        rows,
        periodDays: summary.days,
        // та же норма, по которой оценивается день на «Дне целиком»
        proteinTargetG: computeTargets(facts).computed.proteinG,
        baseline,
      }),
    };
  }

  /**
   * Главный экран: баланс последнего полного дня, питание за сегодня, неделя
   * тренировок и свежесть обоих источников (D-083).
   *
   * «Сегодня» приходит из браузера. Сервер в контейнере живёт по UTC, и после
   * полуночи по Москве его «сегодня» ещё три часа было бы вчерашним днём —
   * питание за сегодня показывало бы вчерашний ужин.
   */
  async home(accountId: string, today?: string): Promise<HomeDto> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const day = today && isIsoDate(today) ? today : todayOf();
    const monday = weekStart(day);

    const [balanceRows, mealRows, workouts, watchTo, diaryTo, facts, lastSync, lastImport] =
      await Promise.all([
        this.balanceRows(accountId, addDays(day, -HOME_BALANCE_WINDOW_DAYS), day),
        this.mealRows(accountId, day),
        this.workoutRows(accountId, monday, addDays(monday, 6)),
        this.watchKnownTo(accountId),
        this.diaryKnownTo(accountId),
        this.facts.collect(accountId),
        // последний удавшийся прогон, а не просто последний: неудачная попытка
        // ничего не добавила, и называть её синхронизацией — врать (D-065)
        this.em.findOne(
          SyncRun,
          { account: accountId, status: 'done', finishedAt: { $ne: null } },
          { orderBy: { finishedAt: 'desc' } },
        ),
        this.em.findOne(
          HealthImport,
          { account: accountId, status: 'done', finishedAt: { $ne: null } },
          { orderBy: { finishedAt: 'desc' } },
        ),
      ]);

    const targets = computeTargets(facts);
    const exportedAt = lastImport?.exportedAt ?? null;
    const completeTo = completeToOf(exportedAt, watchTo);

    return {
      today: day,
      firstName: firstNameOf(account.profile as Record<string, unknown> | null),
      balance: lastFullDay(balanceRows, completeTo),
      food: {
        date: day,
        ...foodOfDay(mealRows),
        targets: targets.computed,
        energyBasis: targets.computed.energyKcal === null ? null : (targets.basis.energy ?? null),
      },
      week: trainingWeek(day, workouts, watchTo),
      freshness: {
        isDemo: account.isDemo,
        yazio: {
          syncedAt: lastSync?.finishedAt?.toISOString() ?? null,
          status: account.lastSyncStatus as AccountSyncStatus,
          dataTo: diaryTo,
        },
        health: {
          importedAt: lastImport?.finishedAt?.toISOString() ?? null,
          exportedAt,
          dataTo: watchTo,
          completeTo,
        },
      },
    };
  }

  async overview(accountId: string, from?: string, to?: string): Promise<AccountOverviewDto> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const [bounds] = await this.em.getConnection().execute<
      Array<{ date_from: string | null; date_to: string | null; days: number }>
    >(
      `select min(date) as date_from, max(date) as date_to, count(*)::int as days
         from day_snapshot where account_id = ?`,
      [accountId],
    );

    const rangeTo = to ?? bounds?.date_to ?? todayOf();
    const rangeFrom = from ?? bounds?.date_from ?? rangeTo;

    const where = { account: accountId, date: { $gte: rangeFrom, $lte: rangeTo } };
    const [nutrients, exercise, weights, products, recipes, snapshots] = await Promise.all([
      this.em.find(DailyNutrients, where),
      this.em.find(DailyExercise, where),
      this.em.find(BodyValue, { ...where, kind: 'weight' }, { orderBy: { loggedAt: 'asc' } }),
      this.em.count(ProductCache, { account: accountId }),
      this.em.count(RecipeCache, { account: accountId }),
      this.em.count(DaySnapshot, where),
    ]);

    const byDate = new Map(nutrients.map((row) => [row.date, row]));
    const stepsByDate = new Map(exercise.map((row) => [row.date, row.steps]));
    // за день бывает несколько взвешиваний — на графике показываем последнее
    const weightByDate = new Map(weights.map((row) => [row.date, row.value]));

    const series: DailyPointDto[] = dateRange(rangeFrom, rangeTo).map((date) => {
      const totals = byDate.get(date);
      return {
        date,
        energyKcal: totals?.energy ?? null,
        energyGoalKcal: totals?.energyGoal ?? null,
        carbsG: totals?.carb ?? null,
        proteinG: totals?.protein ?? null,
        fatG: totals?.fat ?? null,
        steps: stepsByDate.get(date) ?? null,
        weightKg: weightByDate.get(date) ?? null,
      };
    });

    const withFood = series.filter((point) => point.energyKcal !== null);
    const average = (pick: (point: DailyPointDto) => number | null): number | null => {
      const values = withFood.map(pick).filter((value): value is number => value !== null && value > 0);
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    };

    return {
      accountId,
      from: rangeFrom,
      to: rangeTo,
      daysWithData: withFood.length,
      daysInRange: series.length,
      entriesTotal: snapshots,
      productsCached: products,
      recipesCached: recipes,
      avgEnergyKcal: average((point) => point.energyKcal),
      avgEnergyGoalKcal: average((point) => point.energyGoalKcal),
      weightFirstKg: weights[0]?.value ?? null,
      weightLastKg: weights.at(-1)?.value ?? null,
      series,
    };
  }

  // ── строки ─────────────────────────────────────────────────────────────────

  /**
   * По строке на день периода: еда из дневника, расход и шаги из Apple Health,
   * тренировки.
   *
   * Подстановки позиционные, и порядок у них строгий: девять — ветки дневника,
   * три — свёртка Apple Health, три — тренировки. Ровно в том порядке, в каком
   * «?» стоят в тексте запроса.
   */
  private async periodRows(accountId: string, from: string, to: string): Promise<PeriodRow[]> {
    const rows = await this.query<RawPeriodRow>(
      `${ENTRIES_CTE},
       food as (
         select date,
                count(distinct meal)::int as meals,
                sum(energy_kcal)          as energy_kcal,
                sum(protein_g)            as protein_g
           from scaled group by date
       ),
       ${HEALTH_DAILY_CTE},
       workout as (
         select date, count(*)::int as workouts, sum(duration_min) as minutes
           from health_workout
          where account_id = ? and date between ? and ?
          group by date
       ),
       span as (select date from food union select date from health)
       select s.date,
              coalesce(f.meals, 0) as meals,
              f.energy_kcal,
              f.protein_g,
              h.steps,
              case when h.active_kcal is not null or h.basal_kcal is not null
                   then coalesce(h.active_kcal, 0) + coalesce(h.basal_kcal, 0) end as out_kcal,
              coalesce(w.workouts, 0) as workouts,
              coalesce(w.minutes, 0)  as minutes
         from span s
         left join food    f on f.date = s.date
         left join health  h on h.date = s.date
         left join workout w on w.date = s.date
        order by s.date`,
      [
        ...entriesParams(accountId, from, to),
        accountId, from, to, // свёртка Apple Health
        accountId, from, to, // тренировки
      ],
    );

    return rows.map((row) => ({
      date: row.date,
      meals: Number(row.meals ?? 0),
      eatenKcal: toNumber(row.energy_kcal),
      proteinG: toNumber(row.protein_g),
      burnedKcal: toNumber(row.out_kcal),
      steps: toNumber(row.steps),
      workouts: Number(row.workouts ?? 0),
      workoutMin: toNumber(row.minutes) ?? 0,
    }));
  }

  /**
   * Её обычные шаги: среднее за дни с шагами перед периодом.
   *
   * С ними анализ сравнивает активность периода — с собой, а не с таблицей.
   */
  private async baselineSteps(
    accountId: string,
    from: string,
  ): Promise<{ avgSteps: number | null; days: number }> {
    const [row] = await this.query<{ avg: string | null; days: number | string }>(
      `with ${HEALTH_DAILY_CTE}
       select avg(steps) as avg, count(*)::int as days
         from health where steps is not null`,
      [accountId, addDays(from, -ACTIVITY_BASELINE_DAYS), addDays(from, -1)],
    );
    return { avgSteps: toNumber(row?.avg), days: Number(row?.days ?? 0) };
  }

  /** Дни окна, где известны и еда, и расход: из них берётся последний полный. */
  private async balanceRows(accountId: string, from: string, to: string): Promise<BalanceRow[]> {
    const rows = await this.query<RawBalanceRow>(
      `${ENTRIES_CTE},
       food as (
         select date, count(distinct meal)::int as meals, sum(energy_kcal) as energy_kcal
           from scaled group by date
       ),
       ${HEALTH_DAILY_CTE}
       select f.date, f.meals, f.energy_kcal, h.active_kcal, h.basal_kcal
         from food f
         join health h on h.date = f.date
        order by f.date desc`,
      [...entriesParams(accountId, from, to), accountId, from, to],
    );

    return rows.map((row) => ({
      date: row.date,
      meals: Number(row.meals ?? 0),
      eatenKcal: toNumber(row.energy_kcal),
      activeKcal: toNumber(row.active_kcal),
      basalKcal: toNumber(row.basal_kcal),
    }));
  }

  /**
   * Дневник за день по приёмам пищи.
   *
   * Запись без приёма уходит в перекус — так же поступает журнал дня, иначе
   * сумма приёмов здесь и там разошлась бы на эту запись.
   */
  private async mealRows(accountId: string, date: string): Promise<MealRow[]> {
    const rows = await this.query<RawMealRow>(
      `${ENTRIES_CTE}
       select coalesce(meal, 'snack') as meal,
              count(*)::int           as entries,
              sum(energy_kcal)        as energy_kcal,
              sum(protein_g)          as protein_g,
              sum(carbs_g)            as carbs_g,
              sum(fat_g)              as fat_g,
              sum(fiber_g)            as fiber_g
         from scaled
        group by coalesce(meal, 'snack')`,
      entriesParams(accountId, date, date),
    );

    return rows.map((row) => ({
      meal: row.meal,
      entries: Number(row.entries ?? 0),
      energyKcal: toNumber(row.energy_kcal),
      proteinG: toNumber(row.protein_g),
      carbsG: toNumber(row.carbs_g),
      fatG: toNumber(row.fat_g),
      fiberG: toNumber(row.fiber_g),
    }));
  }

  private async workoutRows(accountId: string, from: string, to: string): Promise<WorkoutRow[]> {
    const rows = await this.query<RawWorkoutRow>(
      `select date, type, duration_min, energy_kcal
         from health_workout
        where account_id = ? and date between ? and ?
        order by started_at`,
      [accountId, from, to],
    );

    return rows.map((row) => ({
      date: row.date,
      type: row.type,
      durationMin: toNumber(row.duration_min) ?? 0,
      energyKcal: toNumber(row.energy_kcal),
    }));
  }

  /** По какой день известны часы: последняя дата, где есть расход или шаги. */
  private async watchKnownTo(accountId: string): Promise<string | null> {
    const [row] = await this.query<{ date: string | null }>(
      `select max(date) as date from health_daily
        where account_id = ? and type in (${WATCH_TYPES})`,
      [accountId],
    );
    return row?.date ?? null;
  }

  /** Последний день, где в дневнике есть еда. */
  private async diaryKnownTo(accountId: string): Promise<string | null> {
    const [row] = await this.query<{ date: string | null }>(
      `select max(date) as date from daily_nutrients where account_id = ? and energy > 0`,
      [accountId],
    );
    return row?.date ?? null;
  }

  private query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.em.getConnection().execute<T[]>(sql, params);
  }
}

/** PostgreSQL отдаёт float8 строкой; отсутствующее значение остаётся пустым, а не нулём. */
function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface RawPeriodRow {
  date: string;
  meals: string | number | null;
  energy_kcal: string | null;
  protein_g: string | null;
  steps: string | null;
  out_kcal: string | null;
  workouts: string | number | null;
  minutes: string | number | null;
}

interface RawBalanceRow {
  date: string;
  meals: string | number | null;
  energy_kcal: string | null;
  active_kcal: string | null;
  basal_kcal: string | null;
}

interface RawMealRow {
  meal: string;
  entries: string | number | null;
  energy_kcal: string | null;
  protein_g: string | null;
  carbs_g: string | null;
  fat_g: string | null;
  fiber_g: string | null;
}

interface RawWorkoutRow {
  date: string;
  type: string;
  duration_min: string | null;
  energy_kcal: string | null;
}
