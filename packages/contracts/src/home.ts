import type { AccountSyncStatus } from './accounts.js';
import type { IsoDate, Message } from './common.js';
import { BALANCE_EVEN_KCAL, type MealKey } from './journal.js';
import type { MacroSetDto } from './planner.js';

/**
 * Главный экран: что с балансом, как идёт неделя, что съедено сегодня и свежие
 * ли данные (D-083).
 *
 * Одним ответом, а не пятью запросами страницы: всё это считается от одной
 * даты — сегодняшней по часам браузера. Собранная в пяти местах, она однажды
 * дала бы пять разных «сегодня».
 */

/**
 * Целевой коридор дефицита, ккал в день.
 *
 * Тот же, за который оценка дня ставит полный балл за баланс. Шкала на главном
 * экране и кольцо оценки на «Дне целиком» обязаны хвалить за одно и то же —
 * иначе один экран скажет «в коридоре», а другой снимет баллы за тот же день.
 */
export const DEFICIT_CORRIDOR: [number, number] = [200, 500];

/**
 * За сколько дней назад ищется последний полный день для баланса.
 *
 * Дальше двух месяцев «последний известный баланс» уже не про сейчас, и честнее
 * сказать, что его нет, чем показать весеннее число осенью.
 */
export const HOME_BALANCE_WINDOW_DAYS = 60;

/**
 * Где баланс дня относительно целевого коридора.
 *
 * `target` — дефицит в коридоре; `small` — дефицит есть, но меньше коридора;
 * `deep` — глубже коридора: недоедание тоже не «по плану»; `even` — в пределах
 * сотни килокалорий от нуля; `surplus` — съедено больше, чем потрачено.
 */
export type BalanceZone = 'target' | 'small' | 'deep' | 'even' | 'surplus';

/**
 * Зона баланса — одна функция на сервер и интерфейс.
 *
 * Сервер красит ею день, страница — среднее за период. Две копии правила
 * разошлись бы на границе: 200 ккал дефицита у одной в коридоре, у другой нет.
 */
export function balanceZone(balanceKcal: number): BalanceZone {
  if (balanceKcal > BALANCE_EVEN_KCAL) return 'surplus';
  if (balanceKcal >= -BALANCE_EVEN_KCAL) return 'even';
  const deficit = -balanceKcal;
  if (deficit < DEFICIT_CORRIDOR[0]) return 'small';
  if (deficit <= DEFICIT_CORRIDOR[1]) return 'target';
  return 'deep';
}

/**
 * Баланс последнего полного дня.
 *
 * «Полный» — это известен расход, известна еда и записано не меньше трёх
 * приёмов пищи: то же правило, что у отбора «с едой и расходом» (D-078). Утром
 * сегодняшний день всегда выглядел бы огромным дефицитом — один завтрак против
 * расхода за сутки, — поэтому он показывается, только когда записан целиком.
 */
export interface HomeBalanceDto {
  date: IsoDate;
  eatenKcal: number;
  burnedKcal: number;
  activeKcal: number | null;
  basalKcal: number | null;
  balanceKcal: number;
  zone: BalanceZone;
}

export interface HomeMealDto {
  meal: MealKey | string;
  energyKcal: number | null;
}

/** Питание за сегодня против целей «Режима». */
export interface HomeFoodDto {
  date: IsoDate;
  /** Сколько записей за день; ноль — «ещё ничего не записано», а не «съела ноль». */
  entries: number;
  eaten: MacroSetDto;
  /** Расчётные цели — те же, по которым ставится оценка дня и собирается меню. */
  targets: MacroSetDto;
  /** Откуда цель калорий: расход минус дефицит, её же числами (D-079). */
  energyBasis: Message | null;
  meals: HomeMealDto[];
}

/**
 * Тренировки этой недели против нормы ВОЗ.
 *
 * Пустые числа — «Apple Health за эту неделю ещё не приезжал», а не «ни одной
 * тренировки»: неделю без данных нельзя рисовать нулями в нормах.
 */
export interface HomeWeekDto {
  /** Понедельник недели. */
  from: IsoDate;
  /** Воскресенье недели. */
  to: IsoDate;
  /** По какой день известны данные часов; пусто — Apple Health не загружался. */
  knownTo: IsoDate | null;
  strength: { count: number | null; goal: number };
  cardio: { minutes: number | null; count: number | null; goal: number };
  workouts: number | null;
  minutes: number | null;
  energyKcal: number | null;
}

/** Свежесть обоих источников — по ней видно, можно ли верить остальному экрану. */
export interface HomeFreshnessDto {
  isDemo: boolean;
  yazio: {
    /** Когда закончилась последняя удачная синхронизация. */
    syncedAt: string | null;
    status: AccountSyncStatus;
    /** Последний день, где в дневнике есть еда. */
    dataTo: IsoDate | null;
  };
  health: {
    /** Когда закончилась последняя удачная загрузка выгрузки. */
    importedAt: string | null;
    /** Когда телефон собрал эту выгрузку — `ExportDate` из самого файла. */
    exportedAt: string | null;
    /** Последний день, за который известны показатели часов. */
    dataTo: IsoDate | null;
    /**
     * Последний день, за который расход известен целиком.
     *
     * День, в который собрана выгрузка, в ней обрезан на часе сборки: базовый
     * обмен за полдня — это не «мало потратила», а «сутки ещё не кончились».
     */
    completeTo: IsoDate | null;
  };
}

export interface HomeDto {
  /** Дата, которую страница считает сегодняшней: её присылает браузер. */
  today: IsoDate;
  /** Имя из профиля YAZIO; пусто — приветствие без имени. */
  firstName: string | null;
  balance: HomeBalanceDto | null;
  food: HomeFoodDto;
  week: HomeWeekDto;
  freshness: HomeFreshnessDto;
}
