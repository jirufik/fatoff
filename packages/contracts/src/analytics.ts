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
