import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  DEFAULT_ALGORITHM_SETTINGS,
  MEALS,
  message,
  workoutGroup,
  type AlgorithmSettingsDto,
  type GenerateRequest,
  type GeneratedPlanDto,
  type MealKey,
  type Message,
  type PageDto,
  type PlanDayDto,
  type PlanDto,
  type PlanQuery,
  type SavePlanInput,
  type PoolFilterDto,
  type PoolItemDto,
  type RecostRequest,
  type TargetSettingsDto,
  type TargetsDto,
  type TemplateDto,
} from '@fatoff/contracts';

import { addDays, dateRange, daysBetween, today as todayOf } from '../../common/date.util';
import { Account, MealPlan, PlanTemplate } from '../../database/entities';

import { AccountFactsService } from './facts.service';
import { buildPool, median, type PoolEntry } from './food-pool';
import { assembleDay, buildPlan, mealTargetFor, normalizeShares } from './plan-builder';
import { dayTargets } from './targets';
import { sum, type Chosen, type MealSelection } from './menu-generator';
import { BUILTIN_TEMPLATES } from './templates';
import { computeTargets, resolveTargetSettings } from './targets';
import type { TrainingProfile, TrainingTypeStat } from './training-plan';
import { planTraining } from './training-plan';

/** Дольше этого генерировать нечего: месяц-два — уже предел осмысленного плана. */
const MAX_PERIOD_DAYS = 180;

/**
 * Генератор режима: нормы, пул, сборка, хранение.
 *
 * Сервис только достаёт строки и складывает результат — весь счёт живёт в
 * чистых модулях рядом (`targets`, `food-pool`, `menu-generator`,
 * `training-plan`, `plan-builder`). Так их можно накрыть тестами без поднятой
 * базы, а здесь остаётся то, ради чего сервис и нужен: запросы.
 */
@Injectable()
export class PlannerService {
  constructor(
    private readonly em: EntityManager,
    private readonly facts: AccountFactsService,
  ) {}

  // ── нормы ──────────────────────────────────────────────────────────────────

  async targets(accountId: string, settings?: Partial<TargetSettingsDto>): Promise<TargetsDto> {
    return computeTargets({ ...(await this.facts.collect(accountId)), settings });
  }

  // ── пул ────────────────────────────────────────────────────────────────────

  /**
   * Пул продуктов.
   *
   * `filter` сужает его двумя способами: периодом дневника — «бери то, что она
   * ела вот с этой даты по эту» — и явным списком, когда человек сам отметил, из
   * чего собирать.
   */
  async pool(
    accountId: string,
    over?: Partial<AlgorithmSettingsDto>,
    filter?: PoolFilterDto,
  ): Promise<PoolItemDto[]> {
    const settings = resolveAlgorithm(over);
    const today = filter?.to ?? todayOf();
    const from = filter?.from ?? addDays(today, -Math.round(settings.poolLastUsedMonths * 30.4));

    const rows = await this.query<RawPoolRow>(
      `select d.date,
              item->>'daytime'                        as meal,
              'product:' || (item->>'product_id')     as key,
              'product'                               as kind,
              item->>'product_id'                     as source_id,
              p.name                                  as name,
              p.payload->>'producer'                  as producer,
              p.payload->>'base_unit'                 as base_unit,
              item->>'serving'                        as serving,
              (select (s->>'amount')::float8
                 from jsonb_array_elements(coalesce(p.payload->'servings', '[]'::jsonb)) s
                where s->>'serving' = item->>'serving' limit 1) as serving_amount,
              (item->>'amount')::float8               as amount,
              (p.payload->'nutrients'->>'energy.energy')::float8         as energy,
              (p.payload->'nutrients'->>'nutrient.protein')::float8      as protein,
              (p.payload->'nutrients'->>'nutrient.carb')::float8         as carbs,
              (p.payload->'nutrients'->>'nutrient.fat')::float8          as fat,
              (p.payload->'nutrients'->>'nutrient.dietaryfiber')::float8 as fiber
         from day_snapshot d
         cross join lateral jsonb_array_elements(coalesce(d.consumed->'products', '[]'::jsonb)) item
         join product_cache p
           on p.account_id = d.account_id and p.product_id = item->>'product_id'
        where d.account_id = ? and d.date between ? and ?

       union all

       select d.date,
              item->>'daytime',
              'recipe:' || (item->>'recipe_id'),
              'recipe',
              item->>'recipe_id',
              r.payload->>'name',
              null, 'portion', 'portion', null,
              (item->>'portion_count')::float8,
              (r.payload->'nutrients'->>'energy.energy')::float8,
              (r.payload->'nutrients'->>'nutrient.protein')::float8,
              (r.payload->'nutrients'->>'nutrient.carb')::float8,
              (r.payload->'nutrients'->>'nutrient.fat')::float8,
              (r.payload->'nutrients'->>'nutrient.dietaryfiber')::float8
         from day_snapshot d
         cross join lateral jsonb_array_elements(coalesce(d.consumed->'recipe_portions', '[]'::jsonb)) item
         join recipe_cache r
           on r.account_id = d.account_id and r.recipe_id = item->>'recipe_id'
        where d.account_id = ? and d.date between ? and ?`,
      [accountId, from, today, accountId, from, today],
    );

    const entries: PoolEntry[] = rows.map((row) => ({
      key: row.key,
      kind: row.kind as PoolEntry['kind'],
      sourceId: row.source_id,
      name: row.name ?? row.source_id,
      producer: row.producer,
      baseUnit: row.base_unit,
      serving: row.serving,
      servingAmount: num(row.serving_amount),
      meal: row.meal ?? 'snack',
      date: row.date,
      amount: Number(row.amount ?? 0),
      per: {
        energyKcal: Number(row.energy ?? 0),
        proteinG: Number(row.protein ?? 0),
        carbsG: Number(row.carbs ?? 0),
        fatG: Number(row.fat ?? 0),
        fiberG: Number(row.fiber ?? 0),
      },
    }));

    // при заданном периоде свежесть уже задана самим периодом — второй раз
    // отсеивать по «месяцам назад» значило бы выкинуть то, что человек выбрал
    const pool = buildPool(
      entries,
      filter?.from ? { ...settings, poolLastUsedMonths: 1200 } : settings,
      today,
    );

    const keys = filter?.keys;
    return keys && keys.length > 0 ? pool.filter((item) => keys.includes(item.key)) : pool;
  }

  // ── генерация ──────────────────────────────────────────────────────────────

  async generate(accountId: string, request: GenerateRequest): Promise<GeneratedPlanDto> {
    if (request.from > request.to) throw new Error('Начало периода позже конца');
    if (daysBetween(request.from, request.to) + 1 > MAX_PERIOD_DAYS) {
      throw new Error(`Период длиннее ${MAX_PERIOD_DAYS} дней: план на такой срок смысла не имеет`);
    }

    const targetSettings = resolveTargetSettings(request.targets);
    const algorithm = resolveAlgorithm(request.algorithm);
    const seed = request.seed ?? Math.floor(Math.random() * 2 ** 31);

    const [targets, pool, profile] = await Promise.all([
      this.targets(accountId, request.targets),
      this.pool(accountId, request.algorithm, request.pool),
      this.trainingProfile(accountId),
    ]);

    const dates = dateRange(request.from, request.to);
    const meals = (request.meals?.length ? request.meals : [...MEALS]) as MealKey[];

    const training = planTraining(
      dates,
      profile,
      request.training,
      { deficitKcal: targets.deficitKcal },
      // тренировкам своё зерно: смена состава меню не должна переставлять тренировки
      makeSeeded(seed ^ 0x5f3759df),
    );

    const built = buildPlan({
      dates,
      targets,
      targetSettings,
      algorithm,
      meals,
      pool,
      training,
      pinned: request.pinned,
      seed,
    });

    return {
      from: request.from,
      to: request.to,
      seed,
      // цена минуты по видам едет с планом: тренировку в нём можно поменять,
      // и затраты должны пересчитаться без похода на сервер за справочником
      workoutTypes: profile.types.map((type) => ({
        type: type.type,
        group: type.group,
        avgMin: type.avgMin,
        kcalPerMin: type.avgMin > 0 ? Math.round((type.avgKcal / type.avgMin) * 100) / 100 : 3.5,
        count: type.count,
      })),
      settings: request,
      resolved: { targets: targetSettings, algorithm },
      targets,
      days: built.days,
      summary: built.summary,
      warnings: [...targets.warnings, ...built.warnings],
    };
  }

  /**
   * Пересчёт дня после ручной правки.
   *
   * Браузер присылает состав приёмов пищи — что заменили и на сколько граммов, —
   * а считает всё та же сборка дня, что и при генерации. Второй копии этой
   * арифметики в интерфейсе нет намеренно: разойтись им ничего не мешало бы.
   */
  async recost(accountId: string, request: RecostRequest): Promise<PlanDayDto> {
    const targetSettings = resolveTargetSettings(request.targets);
    const algorithm = resolveAlgorithm(request.algorithm);

    const [targets, pool] = await Promise.all([
      this.targets(accountId, request.targets),
      this.pool(accountId, request.algorithm, request.pool),
    ]);

    const byKey = new Map(pool.map((item) => [item.key, item]));
    const meals = request.meals.map((meal) => meal.meal);
    const shares = normalizeShares(meals, targetSettings);
    const dayGoal = dayTargets(targets.computed, targetSettings, request.workoutKcal);

    const selections: MealSelection[] = [];
    const mealTargets = [];

    for (const meal of request.meals) {
      const target = mealTargetFor(
        meal.meal,
        dayGoal,
        shares[meal.meal] ?? 0,
        targets.proteinPerMealG,
      );
      const items: Chosen[] = meal.items
        .map((entry) => {
          const item = byKey.get(entry.key);
          return item ? { item, amount: entry.amount } : null;
        })
        .filter((chosen): chosen is Chosen => chosen !== null);

      mealTargets.push(target);
      selections.push({
        meal: meal.meal,
        items,
        totals: sum(items),
        cost: 0,
        shortfalls: shortfallsOf(target, items, algorithm),
        locked: 0,
      });
    }

    return assembleDay({
      date: request.date,
      selections,
      mealTargets,
      targets: dayGoal,
      workouts: [],
      workoutKcal: request.workoutKcal,
      leanMass: targets.profile.leanMassKg,
      burn: {
        basalKcal: targets.expenditure.basalKcal,
        activeWithoutWorkoutsKcal: targets.expenditure.activeWithoutWorkoutsKcal,
      },
    });
  }

  /**
   * Её тренировочный профиль: виды с их средними, недельный объём и то, в какие
   * дни она обычно занимается. Всё — из истории Apple Health, а не из таблиц.
   */
  private async trainingProfile(accountId: string): Promise<TrainingProfile> {
    const today = todayOf();
    const from = addDays(today, -365);

    const [types, weekdays, span, sleep] = await Promise.all([
      this.query<RawTypeRow>(
        `select type, count(*)::int as count,
                avg(duration_min) as avg_min,
                avg(energy_kcal)  as avg_kcal
           from health_workout
          where account_id = ? and date between ? and ? and duration_min > 0
          group by type having count(*) >= 3
          order by count(*) desc`,
        [accountId, from, today],
      ),
      this.query<{ weekday: number; count: number }>(
        `select extract(isodow from date::date)::int as weekday, count(*)::int as count
           from health_workout
          where account_id = ? and date between ? and ?
          group by 1`,
        [accountId, from, today],
      ),
      this.query<{ total: number; first: string | null; last: string | null }>(
        `select count(*)::int as total, min(date) as first, max(date) as last
           from health_workout
          where account_id = ? and date between ? and ?`,
        [accountId, from, today],
      ),
      this.query<{ asleep_min: string }>(
        `select asleep_min from health_sleep
          where account_id = ? and night between ? and ? and asleep_min > 0`,
        [accountId, from, today],
      ),
    ]);

    const stats: TrainingTypeStat[] = types.map((row) => ({
      type: row.type,
      group: workoutGroup(row.type),
      avgMin: Math.round(Number(row.avg_min ?? 0)),
      avgKcal: Math.round(Number(row.avg_kcal ?? 0)),
      count: Number(row.count),
    }));

    const load = new Array<number>(7).fill(0);
    for (const row of weekdays) load[Number(row.weekday) - 1] = Number(row.count);

    // недели считаются по тому отрезку, где тренировки правда были: делить на
    // год историю в месяц значит объявить, что она не тренируется вовсе
    const bounds = span[0];
    const covered =
      bounds?.first && bounds.last ? Math.max(1, (daysBetween(bounds.first, bounds.last) + 1) / 7) : 1;

    return {
      types: stats,
      sessionsPerWeek: Number(bounds?.total ?? 0) / covered,
      weekdayLoad: load,
      medianSleepMin: sleep.length > 0 ? median(sleep.map((row) => Number(row.asleep_min))) : null,
    };
  }

  // ── сохранённые планы ──────────────────────────────────────────────────────

  async savePlan(accountId: string, input: SavePlanInput): Promise<PlanDto> {
    const account = await this.account(accountId);
    const record = this.em.create(MealPlan, {
      account,
      name: input.name.trim() || `${input.plan.from} — ${input.plan.to}`,
      tags: normalizeTags(input.tags),
      dateFrom: input.plan.from,
      dateTo: input.plan.to,
      plan: input.plan,
      createdAt: new Date(),
    });

    await this.em.persistAndFlush(record);
    return toPlanDto(record, accountId);
  }

  /**
   * Сохранённые планы: поиск по названию, отбор по меткам, страницы.
   *
   * Метки хранятся списком в jsonb, и отбор идёт оператором `@>` — «содержит
   * все перечисленные». Индекс по нему в PostgreSQL есть, а вот развернуть их
   * в отдельную таблицу ради двух десятков планов было бы лишним.
   */
  async listPlans(accountId: string, query: PlanQuery = {}): Promise<PageDto<PlanDto>> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));

    const where: FilterQuery<MealPlan> = { account: accountId };
    if (query.search?.trim()) {
      Object.assign(where, { name: { $ilike: `%${query.search.trim()}%` } });
    }
    if (query.from) Object.assign(where, { dateTo: { $gte: query.from } });
    if (query.to) Object.assign(where, { dateFrom: { $lte: query.to } });

    const tags = normalizeTags(query.tags);
    if (tags.length > 0) {
      Object.assign(where, { tags: { $contains: tags } });
    }

    const [rows, total] = await this.em.findAndCount(MealPlan, where, {
      orderBy: { createdAt: 'desc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return { items: rows.map((row) => toPlanDto(row, accountId)), total, page, pageSize };
  }

  /** Все метки аккаунта с числом планов — из них строится фильтр. */
  async planTags(accountId: string): Promise<Array<{ tag: string; count: number }>> {
    const rows = await this.query<{ tag: string; count: string }>(
      `select tag, count(*)::int as count
         from meal_plan, jsonb_array_elements_text(tags) as tag
        where account_id = ?
        group by tag
        order by count(*) desc, tag`,
      [accountId],
    );
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  /**
   * Переименовать метку во всех планах сразу.
   *
   * Метка — не сущность, а строка внутри плана, поэтому «переименовать» значит
   * пройти по планам, где она есть, и переписать список. Планов десятки, а не
   * миллионы: делать ради этого отдельную таблицу дороже, чем этот проход.
   */
  async renameTag(accountId: string, from: string, to: string): Promise<{ changed: number }> {
    const [source] = normalizeTags([from]);
    const [target] = normalizeTags([to]);
    if (!source) throw new Error('Не сказано, какую метку переименовать');
    if (!target) throw new Error('Новое имя метки пустое');
    if (source === target) return { changed: 0 };

    const rows = await this.em.find(MealPlan, {
      account: accountId,
      tags: { $contains: [source] },
    } as FilterQuery<MealPlan>);

    for (const row of rows) {
      // повтор схлопнется: если у плана уже была и старая метка, и новая
      row.tags = normalizeTags(row.tags.map((tag) => (tag === source ? target : tag)));
    }
    await this.em.flush();
    return { changed: rows.length };
  }

  /** Убрать метку из всех планов. Сами планы остаются. */
  async removeTag(accountId: string, tag: string): Promise<{ changed: number }> {
    const [victim] = normalizeTags([tag]);
    if (!victim) throw new Error('Не сказано, какую метку убрать');

    const rows = await this.em.find(MealPlan, {
      account: accountId,
      tags: { $contains: [victim] },
    } as FilterQuery<MealPlan>);

    for (const row of rows) row.tags = row.tags.filter((entry) => entry !== victim);
    await this.em.flush();
    return { changed: rows.length };
  }

  async updatePlan(
    accountId: string,
    planId: string,
    patch: { name?: string; tags?: string[] },
  ): Promise<PlanDto> {
    const record = await this.em.findOne(MealPlan, { id: planId, account: accountId });
    if (!record) throw new Error(`План ${planId} не найден`);

    if (patch.name !== undefined && patch.name.trim()) record.name = patch.name.trim();
    if (patch.tags !== undefined) record.tags = normalizeTags(patch.tags);

    await this.em.flush();
    return toPlanDto(record, accountId);
  }

  async plan(accountId: string, planId: string): Promise<PlanDto> {
    const record = await this.em.findOne(MealPlan, { id: planId, account: accountId });
    if (!record) throw new Error(`План ${planId} не найден`);
    return toPlanDto(record, accountId);
  }

  async removePlan(accountId: string, planId: string): Promise<void> {
    const record = await this.em.findOne(MealPlan, { id: planId, account: accountId });
    if (!record) throw new Error(`План ${planId} не найден`);
    await this.em.removeAndFlush(record);
  }

  // ── шаблоны ────────────────────────────────────────────────────────────────

  /** Встроенные впереди своих: сначала то, что предлагает сервис, потом то, что завёл человек. */
  async templates(accountId: string): Promise<TemplateDto[]> {
    const own = await this.em.find(PlanTemplate, { account: accountId }, { orderBy: { createdAt: 'desc' } });

    return [
      ...BUILTIN_TEMPLATES,
      ...own.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        builtin: false,
        settings: row.settings,
        createdAt: row.createdAt.toISOString(),
      })),
    ];
  }

  async saveTemplate(
    accountId: string,
    input: { name: string; description?: string; settings: Partial<GenerateRequest> },
  ): Promise<TemplateDto> {
    const account = await this.account(accountId);
    // период в шаблон не идёт: шаблон говорит «как», а не «когда»
    const { from: _from, to: _to, seed: _seed, ...settings } = input.settings;

    const record = this.em.create(PlanTemplate, {
      account,
      name: input.name.trim() || 'Без имени',
      description: (input.description ?? '').trim(),
      settings,
      createdAt: new Date(),
    });

    await this.em.persistAndFlush(record);
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      builtin: false,
      settings: record.settings,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async removeTemplate(accountId: string, templateId: string): Promise<void> {
    if (templateId.startsWith('builtin:')) throw new Error('Встроенный шаблон удалить нельзя');
    const record = await this.em.findOne(PlanTemplate, { id: templateId, account: accountId });
    if (!record) throw new Error(`Шаблон ${templateId} не найден`);
    await this.em.removeAndFlush(record);
  }

  // ── общее ──────────────────────────────────────────────────────────────────

  private async account(accountId: string): Promise<Account> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);
    return account;
  }

  private query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.em.getConnection().execute<T[]>(sql, params);
  }
}

/** Те же проверки, что и при подборе: допуск по калориям и порог белка. */
function shortfallsOf(
  target: { meal: string; energyKcal: number; proteinFloorG: number },
  items: Chosen[],
  settings: AlgorithmSettingsDto,
): Message[] {
  const totals = sum(items);
  const shortfalls: Message[] = [];
  const tolerance = (target.energyKcal * settings.energyTolerancePct) / 100;

  if (Math.abs(totals.energy - target.energyKcal) > tolerance) {
    shortfalls.push(
      message('meal.off-energy', {
        meal: target.meal,
        actual: Math.round(totals.energy),
        target: Math.round(target.energyKcal),
        tolerance: settings.energyTolerancePct,
      }),
    );
  }
  if (target.proteinFloorG > 0 && totals.protein < target.proteinFloorG) {
    shortfalls.push(
      message('meal.low-protein', {
        meal: target.meal,
        actual: totals.protein.toFixed(1),
        floor: target.proteinFloorG.toFixed(1),
      }),
    );
  }
  return shortfalls;
}

export function resolveAlgorithm(over?: Partial<AlgorithmSettingsDto>): AlgorithmSettingsDto {
  return {
    ...DEFAULT_ALGORITHM_SETTINGS,
    ...over,
    weights: { ...DEFAULT_ALGORITHM_SETTINGS.weights, ...(over?.weights ?? {}) },
  };
}

/** Отдельный поток случайности для тренировок — по тому же зерну, но со своим сдвигом. */
function makeSeeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Метки: без пустых, без повторов, в нижнем регистре и в предсказуемом порядке. */
function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const clean = tags
    .map((tag) => tag.trim().toLowerCase().slice(0, 40))
    .filter((tag) => tag.length > 0);
  return [...new Set(clean)].sort().slice(0, 20);
}

function toPlanDto(record: MealPlan, accountId: string): PlanDto {
  return {
    id: record.id,
    accountId,
    name: record.name,
    tags: record.tags ?? [],
    from: record.dateFrom,
    to: record.dateTo,
    createdAt: record.createdAt.toISOString(),
    plan: record.plan,
  };
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface RawPoolRow {
  date: string;
  meal: string | null;
  key: string;
  kind: string;
  source_id: string;
  name: string | null;
  producer: string | null;
  base_unit: string | null;
  serving: string | null;
  serving_amount: string | null;
  amount: string | null;
  energy: string | null;
  protein: string | null;
  carbs: string | null;
  fat: string | null;
  fiber: string | null;
}

interface RawTypeRow {
  type: string;
  count: number;
  avg_min: string | null;
  avg_kcal: string | null;
}
