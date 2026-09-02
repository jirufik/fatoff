import type { IsoDate } from './common.js';

/** Точка дневного ряда для дашборда. Пустые поля значат «нет данных», не ноль. */
export interface DailyPointDto {
  date: IsoDate;
  energyKcal: number | null;
  energyGoalKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  steps: number | null;
  weightKg: number | null;
}

/**
 * Среднее и сумма за период.
 *
 * `days` — по скольким дням посчитано, и это не украшение: среднее без числа
 * дней нечем поверить. Дни без данных в счёт не идут — забытые на тумбочке часы
 * иначе занижают и расход, и шаги, и человек читает это как «стал меньше
 * двигаться» (D-082).
 */
export interface PeriodValueDto {
  avg: number | null;
  total: number | null;
  days: number;
}

/**
 * Сводка за период для главного экрана: сколько потрачено, сколько съедено,
 * что из этого вышло.
 */
export interface PeriodSummaryDto {
  from: IsoDate;
  to: IsoDate;
  /** Дней в периоде целиком, включая те, о которых ничего не записано. */
  days: number;
  eaten: PeriodValueDto;
  burned: PeriodValueDto;
  /** Только по дням, где известны обе половины: у остальных баланса нет. */
  balance: PeriodValueDto;
  proteinG: PeriodValueDto;
  steps: PeriodValueDto;
  workouts: { count: number; minutes: number };
}

export interface AccountOverviewDto {
  accountId: string;
  from: IsoDate | null;
  to: IsoDate | null;
  /** Дней с записями против дней в периоде. */
  daysWithData: number;
  daysInRange: number;
  entriesTotal: number;
  productsCached: number;
  recipesCached: number;
  avgEnergyKcal: number | null;
  avgEnergyGoalKcal: number | null;
  weightFirstKg: number | null;
  weightLastKg: number | null;
  series: DailyPointDto[];
}
