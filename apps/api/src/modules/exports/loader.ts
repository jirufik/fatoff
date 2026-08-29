import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { AppleHealthQueryService } from '../apple-health/health-query.service';

import type { Dataset } from '@fatoff/contracts';

import {
  Account,
  AccountSnapshot,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  ProductCache,
  RecipeCache,
} from '../../database/entities';
import type { DaySource, ExportSource, HealthSource } from './source';
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

/**
 * Чтение сырья из базы для сборки выгрузки.
 *
 * Сеть не трогается вообще (D-010): всё, что нужно, уже выгружено синхронизацией.
 * Карточки продуктов и рецептов подбираются только те, на которые ссылается
 * дневник за период — иначе выгрузка за неделю тащила бы каталог за годы.
 */
@Injectable()
export class ExportLoader {
  constructor(
    private readonly em: EntityManager,
    private readonly health: AppleHealthQueryService,
  ) {}

  async load(
    account: Account,
    from: string,
    to: string,
    datasets: Set<Dataset>,
    options: { redact: boolean; includeHealth: boolean },
  ): Promise<ExportSource> {
    const em = this.em.fork();

    const [snapshots, dayRows, nutrients, exercise, body] = await Promise.all([
      em.find(AccountSnapshot, { account: account.id }),
      em.find(DaySnapshot, { account: account.id, date: { $gte: from, $lte: to } }, { orderBy: { date: 'asc' } }),
      em.find(DailyNutrients, { account: account.id, date: { $gte: from, $lte: to } }),
      em.find(DailyExercise, { account: account.id, date: { $gte: from, $lte: to } }),
      em.find(BodyValue, { account: account.id, date: { $gte: from, $lte: to } }),
    ]);

    const byKind = new Map(snapshots.map((snapshot) => [snapshot.kind, snapshot.payload]));

    const days = new Map<string, DaySource>();
    const productIds = new Set<string>();
    const recipeIds = new Set<string>();

    for (const row of dayRows) {
      const consumed = (row.consumed as YazioConsumedItems | null) ?? null;
      days.set(row.date, {
        consumed,
        exercises: (row.exercises as YazioExercises | null) ?? null,
        water: (row.water as YazioWater | null) ?? null,
        goals: (row.goals as YazioGoals | null) ?? null,
        goalsUnmodified: (row.goalsUnmodified as YazioGoals | null) ?? null,
        feeling: (row.feeling as YazioFeeling | null) ?? null,
      });

      for (const item of consumed?.products ?? []) productIds.add(item.product_id);
      for (const item of consumed?.recipe_portions ?? []) recipeIds.add(item.recipe_id);
    }

    const [productRows, recipeRows] = await Promise.all([
      productIds.size > 0
        ? em.find(ProductCache, { account: account.id, productId: { $in: [...productIds] } })
        : Promise.resolve([]),
      recipeIds.size > 0
        ? em.find(RecipeCache, { account: account.id, recipeId: { $in: [...recipeIds] } })
        : Promise.resolve([]),
    ]);

    return {
      from,
      to,
      datasets,
      redact: options.redact,

      user: (byKind.get('user') as YazioUser | undefined) ?? (account.profile as YazioUser | null),
      settings: (byKind.get('settings') as YazioSettings | undefined) ?? null,
      dietaryPreferences:
        (byKind.get('dietary_preferences') as YazioDietaryPreferences | undefined) ?? null,
      // массивы хранятся завёрнутыми: колонка jsonb держит объект
      subscriptions: unwrap<YazioSubscription>(byKind.get('subscription')),
      streak: (byKind.get('streak') as YazioStreak | undefined) ?? {},
      fasting: unwrap<YazioFastingSession>(byKind.get('fasting')),

      dailyNutrients: new Map(
        nutrients.map((row) => [
          row.date,
          {
            energy: row.energy,
            carb: row.carb,
            protein: row.protein,
            fat: row.fat,
            energyGoal: row.energyGoal,
          },
        ]),
      ),
      dailyExercise: new Map(
        exercise.map((row) => [row.date, { steps: row.steps, duration: row.duration, energy: row.energy }]),
      ),
      bodyValues: body.map((row) => ({
        kind: row.kind,
        loggedAt: row.loggedAt,
        date: row.date,
        value: row.value,
      })),

      days,
      products: new Map(
        productRows.map((row) => [row.productId, row.payload as unknown as YazioProduct]),
      ),
      recipes: new Map(
        recipeRows.map((row) => [
          row.recipeId,
          { recipe: row.payload as unknown as YazioRecipe, isUserRecipe: row.isUserRecipe },
        ]),
      ),

      health: options.includeHealth ? await this.loadHealth(account.id, from, to) : null,
    };
  }

  /**
   * Данные Apple Health за тот же период. Берутся уже сведёнными: на каждый день
   * и тип один источник, потому что складывать часы с телефоном нельзя.
   * `null`, если выгрузка Apple Health для аккаунта не загружалась.
   */
  private async loadHealth(
    accountId: string,
    from: string,
    to: string,
  ): Promise<HealthSource | null> {
    // выгрузке нужен весь период, а не страница: потолок поднимается явно
    const size = 200_000;
    const [days, workouts, sleep] = await Promise.all([
      this.health.days(accountId, { from, to, pageSize: size, dir: 'asc' }, size),
      this.health.workouts(accountId, { from, to, pageSize: size, dir: 'asc' }, size),
      this.health.sleep(accountId, { from, to, pageSize: size, dir: 'asc' }, size),
    ]);

    if (days.total === 0 && workouts.total === 0 && sleep.total === 0) return null;

    return {
      days: new Map(
        days.items.map((row) => [
          row.date,
          {
            steps: row.steps,
            activeKcal: row.activeKcal,
            basalKcal: row.basalKcal,
            exerciseMin: row.exerciseMin,
            standHours: row.standHours,
            distanceKm: row.distanceKm,
            flights: row.flights,
            restingHr: row.restingHr,
            heartRateAvg: row.heartRateAvg,
            hrvMs: row.hrvMs,
            respiratoryRate: row.respiratoryRate,
            oxygenSaturation: row.oxygenSaturation,
            weightKg: row.weightKg,
          },
        ]),
      ),
      workouts: workouts.items.map((row) => ({ ...row })),
      // за одну ночь записи бывают от нескольких источников: часы, телефон,
      // сторонний трекер. Берём самую полную, а не последнюю — иначе ночь
      // превращается в обрывок и медиана сна уезжает к нулю
      sleep: sleep.items.reduce((best, row) => {
        const current = best.get(row.night);
        if (!current || row.asleepMin > current.asleepMin) best.set(row.night, { ...row });
        return best;
      }, new Map<string, (typeof sleep.items)[number]>()),
    };
  }
}

function unwrap<T>(payload: Record<string, unknown> | undefined): T[] {
  if (!payload) return [];
  const items = (payload as { items?: unknown }).items;
  return Array.isArray(items) ? (items as T[]) : [];
}
