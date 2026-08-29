/**
 * Даты живут строками `YYYY-MM-DD` (D-006).
 *
 * YAZIO оперирует настенными датами пользователя: «что съедено 3 марта» не
 * привязано к моменту времени и не должно зависеть от зоны процесса. Приводить
 * такую дату к `Date` — значит выдумывать точность, которой в данных нет, и
 * получить сдвиг на сутки при первом же переезде часового пояса.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertIsoDate(value: string, what = 'Дата'): string {
  if (!isIsoDate(value)) throw new Error(`${what} должно быть в формате YYYY-MM-DD, получено: ${value}`);
  return value;
}

/** Сегодняшняя дата в локальной зоне процесса. */
export function today(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = assertIsoDate(date).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Все даты от `from` до `to` включительно. */
export function dateRange(from: string, to: string): string[] {
  assertIsoDate(from, 'Начало периода');
  assertIsoDate(to, 'Конец периода');
  if (from > to) throw new Error(`Начало периода ${from} позже конца ${to}`);

  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${assertIsoDate(to)}T00:00:00Z`) - Date.parse(`${assertIsoDate(from)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Дата из отметки времени YAZIO (`YYYY-MM-DD HH:MM:SS`). Именно по ней записи
 * соединяются со всеми остальными таблицами.
 */
export function dayOf(timestamp: string): string {
  return timestamp.split(/[ T]/)[0] ?? timestamp;
}

/** Понедельник недели, в которую попадает дата — для недельной свёртки. */
export function weekStart(date: string): string {
  const [year, month, day] = assertIsoDate(date).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay(): 0 — воскресенье, поэтому неделя сдвигается на понедельник
  const shift = (utc.getUTCDay() + 6) % 7;
  return addDays(date, -shift);
}

/** Первое число месяца — для месячной свёртки. */
export function monthStart(date: string): string {
  return `${assertIsoDate(date).slice(0, 7)}-01`;
}
