import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';

import type { AccountDto } from '@fatoff/contracts';

import { insertMany } from '../../common/insert-many';
import { addDays, today as todayOf } from '../../common/date.util';
import {
  Account,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  HealthDaily,
  HealthSleep,
  HealthWorkout,
  ProductCache,
  RecipeCache,
} from '../../database/entities';
import { AccountsService } from '../accounts/accounts.service';
import { PlannerService } from '../planner/planner.service';
import { buildMenu } from './demo-menu';
import {
  DEMO_PRODUCT_IDS,
  DEMO_RECIPE_IDS,
  QUICK_ADDS,
  demoProduct,
  demoRecipe,
  quickNutrients,
  type DemoLocale,
} from './demo-pantry';
import { DEMO_DAYS, buildStory, type DemoDay } from './demo-story';

/**
 * Демо-аккаунт: сервис, наполненный выдуманной, но правдоподобной историей.
 *
 * Человек развернул проект у себя, а показать ему нечего: без YAZIO и без
 * выгрузки Apple Health все страницы пустые, и понять, ради чего всё это,
 * невозможно. Демо-аккаунт закрывает ровно этот разрыв (D-068).
 *
 * Данные пишутся туда же, куда их кладёт настоящая выгрузка: дневник — сырьём
 * в `day_snapshot`, продукты — карточками в кэш, показатели часов — в таблицы
 * Apple Health. Никакой отдельной ветки «если демо» в расчётах нет и быть не
 * должно: оценка дня, баланс и нормы считаются теми же формулами, что и у
 * настоящего аккаунта, иначе демо показывало бы не этот сервис, а другой.
 */
@Injectable()
export class DemoService {
  private readonly log = new Logger(DemoService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly accounts: AccountsService,
    private readonly planner: PlannerService,
  ) {}

  /** Почта демо-аккаунта: домен `.invalid` зарезервирован RFC 2606 и не существует. */
  static readonly EMAIL = 'demo@fatoff.invalid';

  /**
   * Создать демо-аккаунт или пересобрать существующий.
   *
   * Пересборка — это удаление и создание заново: история привязана к сегодняшней
   * дате, и «дополнить» её нельзя, не разъехавшись с сюжетом.
   */
  async generate(locale: DemoLocale): Promise<AccountDto> {
    const started = Date.now();
    const existing = await this.em.findOne(Account, { email: DemoService.EMAIL });
    if (existing) await this.accounts.remove(existing.id);

    const story = buildStory(todayOf());
    const account = this.em.create(Account, {
      email: DemoService.EMAIL,
      label: locale === 'ru' ? 'Демо' : 'Demo',
      isDemo: true,
      registrationDate: story.from,
      profile: {
        sex: story.profile.sex,
        date_of_birth: story.profile.birthDate,
        body_height: story.profile.heightCm,
        locale,
        // так же, как их отдаёт YAZIO: единицы у неё живут в профиле
        unit_mass: 'kg',
        unit_length: 'cm',
        unit_energy: 'kcal',
      },
      // синхронизировать нечего: ни учётных данных, ни папки
      syncEnabled: false,
      syncDailyAt: null,
      driveEnabled: false,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.em.persistAndFlush(account);
    await this.fill(account, story, locale);
    await this.plan(account.id, locale);

    this.log.log(
      `Демо-аккаунт собран за ${Date.now() - started} мс: ${DEMO_DAYS} дней, язык ${locale}`,
    );
    return this.accounts.detail(account.id);
  }

  /**
   * Один сохранённый план на неделю вперёд.
   *
   * Собирается тем же генератором и из того же дневника, что и у настоящего
   * аккаунта, — иначе раздел «Планы» у демо пустует, а он и есть половина
   * ответа на вопрос «что этот сервис умеет». Сбой здесь не должен ронять
   * генерацию целиком: демо без плана всё ещё демо.
   */
  private async plan(accountId: string, locale: DemoLocale): Promise<void> {
    const from = addDays(todayOf(), 1);
    try {
      const plan = await this.planner.generate(accountId, {
        from,
        to: addDays(from, 6),
        training: { mode: 'current' },
        seed: 4242,
      });
      await this.planner.savePlan(accountId, {
        name: locale === 'ru' ? 'Неделя в дефиците' : 'A week in deficit',
        tags: locale === 'ru' ? ['демо', 'снижение'] : ['demo', 'cutting'],
        plan,
      });
    } catch (error) {
      this.log.warn(`Демо-план собрать не удалось: ${(error as Error).message}`);
    }
  }

  /** Есть ли демо и какое оно. */
  async find(): Promise<AccountDto | null> {
    const account = await this.em.findOne(Account, { email: DemoService.EMAIL });
    return account ? this.accounts.detail(account.id) : null;
  }

  private async fill(
    account: Account,
    story: ReturnType<typeof buildStory>,
    locale: DemoLocale,
  ): Promise<void> {
    await this.em.transactional(async (tx) => {
      await this.catalogues(tx, account, locale);

      const snapshots: Array<Record<string, unknown>> = [];
      const nutrients: Array<Record<string, unknown>> = [];
      const exercise: Array<Record<string, unknown>> = [];
      const daily: Array<Record<string, unknown>> = [];
      const sleep: Array<Record<string, unknown>> = [];
      const workouts: Array<Record<string, unknown>> = [];
      const body: Array<Record<string, unknown>> = [];
      const fetchedAt = new Date();

      // тот же генератор, что и в сюжете: меню дня должно быть воспроизводимым
      let seed = 7211;
      const random = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (const day of story.days) {
        const weekend = [0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay());
        const menu = day.logged ? buildMenu(day.intakeKcal, weekend, day.splurge, random) : null;

        snapshots.push({
          account,
          date: day.date,
          consumed: menu ? this.consumed(menu, day.date, locale) : { products: [], recipe_portions: [], simple_products: [] },
          exercises: this.exercises(day, locale),
          water: { water_intake: Math.round(1200 + random() * 900) },
          goals: GOALS,
          goalsUnmodified: GOALS,
          feeling: null,
          fetchedAt,
        });

        if (menu) {
          nutrients.push({
            account,
            date: day.date,
            energy: round(menu.kcal, 1),
            carb: round(menu.carb, 1),
            protein: round(menu.protein, 1),
            fat: round(menu.fat, 1),
            energyGoal: GOALS['energy.energy'],
            fetchedAt,
          });
        }

        exercise.push({
          account,
          date: day.date,
          steps: day.tracked ? day.steps : 0,
          duration: day.workout ? day.workout.durationMin * 60 : 0,
          energy: day.workout ? day.workout.kcal : 0,
          fetchedAt,
        });

        if (day.tracked) daily.push(...this.healthDaily(account, day));

        if (day.sleep) {
          const fell = minutesToTime(day.date, day.sleep.fellAsleepMin, -1);
          sleep.push({
            account,
            night: day.date,
            source: SOURCE_WATCH,
            inBedMin: day.sleep.inBedMin,
            asleepMin: day.sleep.asleepMin,
            deepMin: day.sleep.deepMin,
            remMin: day.sleep.remMin,
            coreMin: day.sleep.coreMin,
            awakeMin: day.sleep.awakeMin,
            fellAsleepAt: fell,
            wokeAt: minutesToTime(day.date, day.sleep.fellAsleepMin + day.sleep.inBedMin, -1),
          });
        }

        if (day.workout) {
          workouts.push({
            account,
            date: day.date,
            startedAt: minutesToTime(day.date, day.workout.startMin),
            endedAt: minutesToTime(day.date, day.workout.startMin + day.workout.durationMin),
            type: day.workout.type,
            durationMin: day.workout.durationMin,
            energyKcal: day.workout.kcal,
            distanceKm: day.workout.distanceKm,
            source: SOURCE_WATCH,
          });
        }

        if (day.weightKg !== null) {
          body.push({
            account,
            kind: 'weight',
            loggedAt: minutesToTime(day.date, 7 * 60 + 20),
            date: day.date,
            value: day.weightKg,
          });
        }
        if (day.bodyFatPct !== null) {
          body.push({
            account,
            kind: 'body_fat',
            loggedAt: minutesToTime(day.date, 7 * 60 + 22),
            date: day.date,
            value: day.bodyFatPct,
          });
        }
      }

      await insertMany(tx, DaySnapshot, snapshots);
      await insertMany(tx, DailyNutrients, nutrients);
      await insertMany(tx, DailyExercise, exercise);
      await insertMany(tx, HealthDaily, daily);
      await insertMany(tx, HealthSleep, sleep);
      await insertMany(tx, HealthWorkout, workouts);
      await insertMany(tx, BodyValue, body);
    });
  }

  /** Карточки продуктов и рецептов: без них дневник покажет «Unknown (id)». */
  private async catalogues(em: EntityManager, account: Account, locale: DemoLocale): Promise<void> {
    const fetchedAt = new Date();
    await insertMany(
      em,
      ProductCache,
      DEMO_PRODUCT_IDS.map((id) => {
        const product = demoProduct(id, locale);
        return { account, productId: id, payload: product.payload, name: product.name, fetchedAt };
      }),
    );
    await insertMany(
      em,
      RecipeCache,
      DEMO_RECIPE_IDS.map((id) => ({
        account,
        recipeId: id,
        payload: demoRecipe(id, locale),
        isUserRecipe: true,
        fetchedAt,
      })),
    );
  }

  /** Дневник в том виде, в каком его отдаёт YAZIO. */
  private consumed(
    menu: ReturnType<typeof buildMenu>,
    date: string,
    locale: DemoLocale,
  ): Record<string, unknown> {
    const products = [];
    const recipePortions = [];
    const simpleProducts = [];

    for (const entry of menu.entries) {
      const at = minutesToTime(date, entry.atMin);
      if (entry.kind === 'product') {
        products.push({
          product_id: entry.id,
          date: at,
          daytime: entry.meal,
          amount: entry.amount,
          serving: null,
          serving_quantity: null,
        });
      } else if (entry.kind === 'recipe') {
        recipePortions.push({
          recipe_id: entry.id,
          date: at,
          daytime: entry.meal,
          portion_count: entry.amount,
        });
      } else {
        const quick = QUICK_ADDS.find((item) => item.id === entry.id)!;
        simpleProducts.push({
          date: at,
          daytime: entry.meal,
          name: quick[locale],
          nutrients: quickNutrients(quick.macros),
        });
      }
    }

    return { products, recipe_portions: recipePortions, simple_products: simpleProducts };
  }

  /** Активность в том виде, в каком её отдаёт YAZIO: шаги и тренировки. */
  private exercises(day: DemoDay, locale: DemoLocale): Record<string, unknown> {
    return {
      activity: {
        energy: day.tracked ? Math.round(day.activeKcal * 0.6) : 0,
        steps: day.tracked ? day.steps : 0,
        distance: day.tracked ? Math.round(day.distanceKm * 1000) : 0,
        duration: day.tracked ? day.exerciseMin * 60 : 0,
        source: 'apple-health',
        gateway: 'apple-health',
      },
      training: day.workout
        ? [
            {
              id: `${day.date}-training`,
              name: locale === 'ru' ? 'Тренировка' : 'Workout',
              energy: day.workout.kcal,
              duration: day.workout.durationMin * 60,
              distance: day.workout.distanceKm === null ? 0 : Math.round(day.workout.distanceKm * 1000),
              gateway: 'apple-health',
              source: 'apple-health',
            },
          ]
        : [],
      custom_training: [],
    };
  }

  /** Показатели часов за день: те типы, из которых сервис считает расход. */
  private healthDaily(account: Account, day: DemoDay): Array<Record<string, unknown>> {
    const rows: Array<[string, string, number, number, number | null]> = [
      ['StepCount', 'count', day.steps, day.steps, null],
      ['ActiveEnergyBurned', 'kcal', day.activeKcal, 240, null],
      ['BasalEnergyBurned', 'kcal', day.basalKcal, 288, null],
      ['AppleExerciseTime', 'min', day.exerciseMin, 24, null],
      ['DistanceWalkingRunning', 'km', day.distanceKm, day.steps, null],
      ['FlightsClimbed', 'count', day.flights, day.flights, null],
      ['RestingHeartRate', 'count/min', day.restingHr, 1, day.restingHr],
      ['AppleStandHour/Stood', 'hour', day.standHours, day.standHours, null],
    ];

    return rows.map(([type, unit, sum, samples, avg]) => ({
      account,
      date: day.date,
      type,
      source: SOURCE_WATCH,
      unit,
      samples,
      sum: round(sum, 2),
      min: null,
      max: null,
      avg,
    }));
  }
}

/** Часы — один источник на все показатели: складывать источники нельзя. */
const SOURCE_WATCH = 'Apple Watch';

/**
 * Цели YAZIO: человек ставит их один раз и живёт с ними месяцами.
 *
 * Держатся отдельно от расчёта норм намеренно: смысл страницы «Режим» в том и
 * состоит, чтобы показать разницу между тем, что стоит в приложении, и тем, что
 * следует из её собственных данных.
 */
const GOALS: Record<string, number> = {
  'energy.energy': 1650,
  'nutrient.protein': 105,
  'nutrient.carb': 165,
  'nutrient.fat': 55,
  'nutrient.dietaryfiber': 30,
};

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Отметка времени записи: `YYYY-MM-DDTHH:MM:SS`.
 *
 * Без часового пояса — ровно так их отдаёт YAZIO и так же хранит Apple Health в
 * своей выгрузке; сдвиг `dayShift` нужен засыпанию, которое случается накануне.
 */
function minutesToTime(date: string, minutes: number, dayShift = 0): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + dayShift);
  at.setUTCMinutes(at.getUTCMinutes() + minutes);
  return at.toISOString().slice(0, 19);
}
