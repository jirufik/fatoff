import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { AccountOverviewDto, DailyPointDto } from '@fatoff/contracts';

import { dateRange, today as todayOf } from '../../common/date.util';
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
