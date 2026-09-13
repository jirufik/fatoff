import type { IsoDate, Message } from './common.js';

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
 * День периода для графика «съедено против расхода».
 *
 * В ряду есть каждая дата периода: день без данных — это пустые значения, а не
 * пропуск. Иначе на графике неделя без часов схлопнулась бы, и соседние дни
 * встали бы рядом, как будто между ними ничего не было.
 */
export interface PeriodDayDto {
  date: IsoDate;
  eatenKcal: number | null;
  burnedKcal: number | null;
}

/**
 * Один вывод анализа словами.
 *
 * Фраза едет кодом и числами, собирает её интерфейс (D-044). Рядом — `basis`:
 * на каких числах и по какому правилу вывод сделан. Вывод без него — то же
 * число без подписи, против которого и затевался главный экран (D-079).
 */
export interface AnalysisLineDto {
  key: 'balance' | 'stability' | 'protein' | 'activity';
  text: Message;
  basis: Message;
  /** `mute` — данных мало, и вывода по сути нет. */
  tone: 'ok' | 'info' | 'warn' | 'mute';
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
  /** Каждый день периода по порядку — для графика. */
  series: PeriodDayDto[];
  /** Выводы словами за тот же период (D-083). */
  analysis: AnalysisLineDto[];
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
