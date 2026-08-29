import type { IsoDate } from './common.js';

/** Страница выдачи: сами строки плюс сколько их всего под фильтром. */
export interface PageDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export type DiarySort = 'date' | 'energy' | 'product';
export type SortDir = 'asc' | 'desc';

export interface DiaryQuery {
  from?: IsoDate;
  to?: IsoDate;
  /** breakfast | lunch | dinner | snack; пусто — все. */
  meal?: string;
  /** product | recipe_portion | simple_product; пусто — все. */
  kind?: string;
  /** Поиск по названию продукта, без учёта регистра. */
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: DiarySort;
  dir?: SortDir;
}

export interface DiaryRowDto {
  date: IsoDate;
  loggedAt: string;
  meal: string;
  kind: string;
  name: string;
  producer: string | null;
  sourceId: string | null;
  amount: number | null;
  serving: string | null;
  energyKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
}

export type DaySort = 'date' | 'energy';

export interface DayQuery {
  from?: IsoDate;
  to?: IsoDate;
  /** Только дни, где есть хотя бы одна запись о еде. */
  withFood?: boolean;
  page?: number;
  pageSize?: number;
  sort?: DaySort;
  dir?: SortDir;
}

export interface DayRowDto {
  date: IsoDate;
  entries: number;
  energyKcal: number | null;
  energyGoalKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  steps: number | null;
  waterMl: number | null;
  weightKg: number | null;
}

export type ProductSort = 'entries' | 'energy' | 'name';

export interface ProductQuery {
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: ProductSort;
  dir?: SortDir;
}

export interface ProductRowDto {
  productId: string;
  name: string | null;
  producer: string | null;
  category: string | null;
  baseUnit: string | null;
  /** Ккал на одну базовую единицу — как их отдаёт YAZIO, не на 100 г. */
  energyPerUnit: number | null;
  /** Сколько раз продукт встречается в дневнике и сколько всего дал энергии. */
  entries: number;
  totalEnergyKcal: number | null;
  lastUsed: IsoDate | null;
}

export interface MeasurementQuery {
  kind?: string;
  from?: IsoDate;
  to?: IsoDate;
  page?: number;
  pageSize?: number;
  dir?: SortDir;
}

export interface MeasurementRowDto {
  date: IsoDate;
  loggedAt: string;
  kind: string;
  value: number;
}
