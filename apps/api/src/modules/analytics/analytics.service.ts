import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { AccountOverviewDto, DailyPointDto, PeriodSummaryDto } from '@fatoff/contracts';

import { addDays, dateRange, daysBetween, today as todayOf } from '../../common/date.util';
import { ENTRIES_CTE, entriesParams } from '../../common/entries.sql';
import { HEALTH_DAILY_CTE } from '../apple-health/health.sql';
import {
  Account,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  ProductCache,
  RecipeCache,
} from '../../database/entities';

/**
 * Сводка для дашборда.
 *
 * Считается по плоским рядам, а не по сырью: они для того и заведены, чтобы
 * страница аккаунта открывалась одним запросом, не разбирая jsonb за годы.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Сводка за период: расход, съеденное и что из этого вышло.
   *
   * Считается тем же разбором дневника и той же свёрткой Apple Health, что и
   * журнал дня: держать вторую арифметику значило бы получить два разных ответа
   * на один вопрос — на главном экране одно число, на «Дне целиком» другое.
   *
   * Среднее берётся по дням, где данные есть, а не по всем дням периода. День,
   * когда часы остались на тумбочке, — это «не знаем», а не «не двигалась»; в
   * среднем он занижал бы расход и превращал бы забытые часы в упадок сил.
   * Сколько дней попало в счёт, едет наружу рядом с числом (D-082).
   */
  async summary(accountId: string, from?: string, to?: string): Promise<PeriodSummaryDto> {
    const rangeTo = to ?? todayOf();
    const rangeFrom = from ?? addDays(rangeTo, -6);

    const [row] = await this.em.getConnection().execute<Array<Record<string, string | number | null>>>(
      `${ENTRIES_CTE},
       food as (
         select date, sum(energy_kcal) as energy_kcal, sum(protein_g) as protein_g
           from scaled group by date
       ),
       ${HEALTH_DAILY_CTE},
       workout as (
         select date, count(*)::int as workouts, sum(duration_min) as minutes
           from health_workout
          where account_id = ? and date between ? and ?
          group by date
       ),
       span as (select date from food union select date from health),
       joined as (
         select s.date,
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
       )
       select count(*) filter (where energy_kcal is not null)::int as days_eaten,
              count(*) filter (where out_kcal is not null)::int    as days_burned,
              count(*) filter (where energy_kcal is not null and out_kcal is not null)::int as days_balance,
              count(*) filter (where steps is not null)::int       as days_steps,
              sum(energy_kcal)                                     as eaten,
              sum(out_kcal)                                        as burned,
              sum(energy_kcal - out_kcal)
                filter (where energy_kcal is not null and out_kcal is not null) as balance,
              sum(protein_g)                                       as protein,
              sum(steps)                                           as steps,
              sum(workouts)::int                                   as workouts,
              sum(minutes)                                         as minutes
         from joined`,
      [
        ...entriesParams(accountId, rangeFrom, rangeTo),
        accountId, rangeFrom, rangeTo, // тренировки
      ],
    );

    const num = (value: unknown): number | null => {
      const parsed = Number(value);
      return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
    };
    const part = (total: unknown, days: unknown): { avg: number | null; total: number | null; days: number } => {
      const sum = num(total);
      const count = Number(days ?? 0);
      return { avg: sum === null || count === 0 ? null : round(sum / count, 1), total: round(sum, 1), days: count };
    };

    return {
      from: rangeFrom,
      to: rangeTo,
      days: daysBetween(rangeFrom, rangeTo) + 1,
      eaten: part(row?.eaten, row?.days_eaten),
      burned: part(row?.burned, row?.days_burned),
      balance: part(row?.balance, row?.days_balance),
      proteinG: part(row?.protein, row?.days_eaten),
      steps: part(row?.steps, row?.days_steps),
      workouts: {
        count: Number(row?.workouts ?? 0),
        minutes: Math.round(Number(row?.minutes ?? 0)),
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
}

function round(value: number | null, digits = 0): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
