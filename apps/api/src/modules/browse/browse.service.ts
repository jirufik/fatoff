import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type {
  DayQuery,
  DayRowDto,
  DiaryQuery,
  DiaryRowDto,
  HealthDayRowDto,
  HealthSleepRowDto,
  HealthWorkoutRowDto,
  MeasurementQuery,
  MeasurementRowDto,
  PageDto,
  ProductQuery,
  ProductRowDto,
} from '@fatoff/contracts';

import { ENTRIES_CTE, entriesParams } from '../../common/entries.sql';
import { AppleHealthQueryService } from '../apple-health/health-query.service';

import { Account } from '../../database/entities';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Просмотр выгруженного прямо в браузере.
 *
 * Всё делает PostgreSQL: фильтр, сортировка, подсчёт и вырезка страницы идут
 * одним запросом, наружу уезжает ровно страница. Тянуть шесть лет дневника в
 * Node, чтобы показать полсотни строк, — самый простой способ сделать интерфейс
 * неотзывчивым.
 *
 * Развёртка дневника из сырья живёт в `common/entries.sql`: тем же разбором
 * пользуются журнал дня и генератор. На шестилетнем аккаунте — 7098 записей —
 * это 18 мс.
 */

@Injectable()
export class BrowseService {
  constructor(
    private readonly em: EntityManager,
    private readonly health: AppleHealthQueryService,
  ) {}

  // ── дневник ────────────────────────────────────────────────────────────────

  async diary(accountId: string, query: DiaryQuery): Promise<PageDto<DiaryRowDto>> {
    const { from, to } = await this.range(accountId, query.from, query.to);
    const { page, pageSize, offset } = paging(query.page, query.pageSize);

    const params = entriesParams(accountId, from, to);
    const filters: string[] = [];

    if (query.meal) {
      filters.push('meal = ?');
      params.push(query.meal);
    }
    if (query.kind) {
      filters.push('kind = ?');
      params.push(query.kind);
    }
    if (query.search) {
      filters.push('name ilike ?');
      params.push(`%${query.search}%`);
    }

    const where = filters.length > 0 ? `where ${filters.join(' and ')}` : '';
    const order = orderBy(
      { date: 'date', energy: 'energy_kcal', product: 'name' },
      query.sort ?? 'date',
      query.dir ?? 'desc',
      'date',
      // вторичный ключ обязателен: без него страницы «плавают» между запросами
      'logged_at desc, name asc',
    );
    params.push(pageSize, offset);

    const rows = await this.query<RawDiaryRow>(
      `${ENTRIES_CTE}
       select *, count(*) over () as total
         from scaled ${where}
        ${order}
        limit ? offset ?`,
      params,
    );

    return { items: rows.map(toDiaryRow), total: totalOf(rows), page, pageSize };
  }

  // ── по дням ────────────────────────────────────────────────────────────────

  async days(accountId: string, query: DayQuery): Promise<PageDto<DayRowDto>> {
    const { from, to } = await this.range(accountId, query.from, query.to);
    const { page, pageSize, offset } = paging(query.page, query.pageSize);

    const order = orderBy(
      { date: 'date', energy: 'energy_kcal' },
      query.sort ?? 'date',
      query.dir ?? 'desc',
      'date',
    );

    // число записей берётся длиной массивов, без разворачивания: строк здесь
    // столько же, сколько дней, и разворачивать незачем
    const rows = await this.query<RawDayRow>(
      `with days as (
         select d.date,
                jsonb_array_length(coalesce(d.consumed->'products', '[]'::jsonb))
                + jsonb_array_length(coalesce(d.consumed->'recipe_portions', '[]'::jsonb))
                + jsonb_array_length(coalesce(d.consumed->'simple_products', '[]'::jsonb)) as entries,
                (d.water->>'water_intake')::float8 as water_ml,
                n.energy as energy_kcal, n.energy_goal as energy_goal_kcal,
                n.carb as carbs_g, n.protein as protein_g, n.fat as fat_g,
                e.steps as steps,
                (select b.value from body_value b
                  where b.account_id = d.account_id and b.kind = 'weight' and b.date = d.date
                  order by b.logged_at desc limit 1) as weight_kg
           from day_snapshot d
           left join daily_nutrients n on n.account_id = d.account_id and n.date = d.date
           left join daily_exercise e on e.account_id = d.account_id and e.date = d.date
          where d.account_id = ? and d.date between ? and ?
       )
       select *, count(*) over () as total
         from days
        ${query.withFood ? 'where entries > 0' : ''}
        ${order}
        limit ? offset ?`,
      [accountId, from, to, pageSize, offset],
    );

    return {
      items: rows.map((row) => ({
        date: row.date,
        entries: Number(row.entries ?? 0),
        energyKcal: numeric(row.energy_kcal),
        energyGoalKcal: numeric(row.energy_goal_kcal),
        carbsG: numeric(row.carbs_g),
        proteinG: numeric(row.protein_g),
        fatG: numeric(row.fat_g),
        steps: numeric(row.steps),
        waterMl: numeric(row.water_ml),
        weightKg: numeric(row.weight_kg),
      })),
      total: totalOf(rows),
      page,
      pageSize,
    };
  }

  // ── продукты ───────────────────────────────────────────────────────────────

  async products(accountId: string, query: ProductQuery): Promise<PageDto<ProductRowDto>> {
    const { page, pageSize, offset } = paging(query.page, query.pageSize);

    const params: unknown[] = [accountId, accountId];
    let search = '';
    if (query.search) {
      search = 'and c.name ilike ?';
      params.push(`%${query.search}%`);
    }
    params.push(pageSize, offset);

    const order = orderBy(
      { entries: 'entries', energy: 'total_energy_kcal', name: 'name' },
      query.sort ?? 'entries',
      query.dir ?? 'desc',
      'entries',
      'name asc',
    );

    const rows = await this.query<RawProductRow>(
      `with used as (
         select item->>'product_id' as product_id,
                count(*)            as entries,
                max(d.date)         as last_used,
                sum((item->>'amount')::float8) as amount_total
           from day_snapshot d
           cross join lateral jsonb_array_elements(coalesce(d.consumed->'products', '[]'::jsonb)) item
          where d.account_id = ?
          group by 1
       )
       select c.product_id,
              c.name,
              c.payload->>'producer'  as producer,
              c.payload->>'category'  as category,
              c.payload->>'base_unit' as base_unit,
              (c.payload->'nutrients'->>'energy.energy')::float8 as energy_per_unit,
              coalesce(u.entries, 0) as entries,
              u.last_used,
              (c.payload->'nutrients'->>'energy.energy')::float8 * u.amount_total as total_energy_kcal,
              count(*) over () as total
         from product_cache c
         left join used u on u.product_id = c.product_id
        where c.account_id = ? ${search}
        ${order}
        limit ? offset ?`,
      params,
    );

    return {
      items: rows.map((row) => ({
        productId: row.product_id,
        name: row.name,
        producer: row.producer,
        category: row.category,
        baseUnit: row.base_unit,
        energyPerUnit: numeric(row.energy_per_unit),
        entries: Number(row.entries ?? 0),
        totalEnergyKcal: numeric(row.total_energy_kcal),
        lastUsed: row.last_used,
      })),
      total: totalOf(rows),
      page,
      pageSize,
    };
  }

  // ── замеры ─────────────────────────────────────────────────────────────────

  async measurements(
    accountId: string,
    query: MeasurementQuery,
  ): Promise<PageDto<MeasurementRowDto>> {
    const { from, to } = await this.range(accountId, query.from, query.to);
    const { page, pageSize, offset } = paging(query.page, query.pageSize);

    const params: unknown[] = [accountId, from, to];
    let kindFilter = '';
    if (query.kind) {
      kindFilter = 'and kind = ?';
      params.push(query.kind);
    }
    params.push(pageSize, offset);

    const rows = await this.query<RawMeasurementRow>(
      `select date, logged_at, kind, value, count(*) over () as total
         from body_value
        where account_id = ? and date between ? and ? ${kindFilter}
        order by logged_at ${query.dir === 'asc' ? 'asc' : 'desc'}
        limit ? offset ?`,
      params,
    );

    return {
      items: rows.map((row) => ({
        date: row.date,
        loggedAt: row.logged_at,
        kind: row.kind,
        value: Number(row.value),
      })),
      total: totalOf(rows),
      page,
      pageSize,
    };
  }

  // ── Apple Health ───────────────────────────────────────────────────────────
  // Запросы живут в модуле apple-health: ими пользуется и просмотр, и выгрузка,
  // а держать один и тот же разбор в двух местах — верный способ развести их.

  healthDays(accountId: string, query: DayQuery): Promise<PageDto<HealthDayRowDto>> {
    return this.health.days(accountId, query);
  }

  healthWorkouts(accountId: string, query: DayQuery): Promise<PageDto<HealthWorkoutRowDto>> {
    return this.health.workouts(accountId, query);
  }

  healthSleep(accountId: string, query: DayQuery): Promise<PageDto<HealthSleepRowDto>> {
    return this.health.sleep(accountId, query);
  }

  // ── общее ──────────────────────────────────────────────────────────────────

  private query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.em.getConnection().execute<T[]>(sql, params);
  }

  /** Границы периода: по умолчанию — всё, что есть в базе по этому аккаунту. */
  private async range(
    accountId: string,
    from?: string,
    to?: string,
  ): Promise<{ from: string; to: string }> {
    if (from && to) return { from, to };

    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const [bounds] = await this.em.getConnection().execute<
      Array<{ date_from: string | null; date_to: string | null }>
    >('select min(date) as date_from, max(date) as date_to from day_snapshot where account_id = ?', [
      accountId,
    ]);

    return {
      from: from ?? bounds?.date_from ?? '1970-01-01',
      to: to ?? bounds?.date_to ?? '2999-12-31',
    };
  }
}

interface WithTotal {
  total: string | number;
}

interface RawDiaryRow extends WithTotal {
  date: string;
  logged_at: string;
  meal: string;
  kind: string;
  source_id: string | null;
  amount: string | number | null;
  serving: string | null;
  name: string;
  producer: string | null;
  energy_kcal: string | number | null;
  carbs_g: string | number | null;
  protein_g: string | number | null;
  fat_g: string | number | null;
}

interface RawDayRow extends WithTotal {
  date: string;
  entries: number;
  energy_kcal: string | number | null;
  energy_goal_kcal: string | number | null;
  carbs_g: string | number | null;
  protein_g: string | number | null;
  fat_g: string | number | null;
  steps: string | number | null;
  water_ml: string | number | null;
  weight_kg: string | number | null;
}

interface RawProductRow extends WithTotal {
  product_id: string;
  name: string | null;
  producer: string | null;
  category: string | null;
  base_unit: string | null;
  energy_per_unit: string | number | null;
  entries: string | number;
  last_used: string | null;
  total_energy_kcal: string | number | null;
}

interface RawMeasurementRow extends WithTotal {
  date: string;
  logged_at: string;
  kind: string;
  value: string | number;
}

/** Оконный `count(*) over ()` едет в каждой строке; на пустой выдаче его нет. */
function totalOf(rows: WithTotal[]): number {
  return Number(rows[0]?.total ?? 0);
}

function toDiaryRow(row: RawDiaryRow): DiaryRowDto {
  return {
    date: row.date,
    loggedAt: row.logged_at,
    meal: row.meal,
    kind: row.kind,
    name: row.name,
    producer: row.producer || null,
    sourceId: row.source_id,
    amount: numeric(row.amount),
    serving: row.serving || null,
    energyKcal: numeric(row.energy_kcal),
    carbsG: numeric(row.carbs_g),
    proteinG: numeric(row.protein_g),
    fatG: numeric(row.fat_g),
  };
}

/** PostgreSQL отдаёт float8 строкой; отсутствующее значение остаётся пустым, а не нулём. */
function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function paging(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; offset: number } {
  const size = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const current = Math.max(Number(page) || 1, 1);
  return { page: current, pageSize: size, offset: (current - 1) * size };
}

/**
 * Сортировка только по белому списку колонок: имя колонки подстановкой не
 * задаётся, и пускать туда пришедшее с фронта нельзя.
 */
function orderBy(
  allowed: Record<string, string>,
  sort: string,
  dir: string,
  fallback: string,
  secondary?: string,
): string {
  const column = allowed[sort] ?? allowed[fallback];
  const direction = dir === 'asc' ? 'asc' : 'desc';
  return `order by ${column} ${direction} nulls last${secondary ? `, ${secondary}` : ''}`;
}
