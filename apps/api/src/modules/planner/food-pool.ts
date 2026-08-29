import type { AlgorithmSettingsDto, MealKey, PerUnitDto, PoolItemDto } from '@fatoff/contracts';

/**
 * Пул продуктов: из чего генератору вообще выбирать.
 *
 * Только то, что есть в её дневнике. Придуманное блюдо, которого нет ни дома,
 * ни в магазине, — не план, а пожелание; поэтому список собирается из настоящих
 * записей с настоящими граммовками.
 *
 * Быстрые записи («Ужин в гостях») в пул не идут: питательности на единицу у них
 * нет — нутриенты записаны итогом за раз, — и повторить их нельзя.
 */

/** Доля использований продукта в приёме пищи, ниже которой связь считается случайной. */
const MEAL_SHARE_FLOOR = 0.2;

export interface PoolEntry {
  key: string;
  kind: 'product' | 'recipe';
  sourceId: string;
  name: string;
  producer: string | null;
  baseUnit: string | null;
  serving: string | null;
  servingAmount: number | null;
  meal: string;
  date: string;
  amount: number;
  per: PerUnitDto;
}

export type PoolSettings = Pick<
  AlgorithmSettingsDto,
  'poolMinEntries' | 'poolLastUsedMonths' | 'minPortionFactor' | 'maxPortionFactor'
>;

export function buildPool(entries: PoolEntry[], settings: PoolSettings, today: string): PoolItemDto[] {
  const grouped = new Map<string, PoolEntry[]>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) continue;
    if (!Number.isFinite(entry.per.energyKcal) || entry.per.energyKcal <= 0) continue;
    const list = grouped.get(entry.key) ?? [];
    list.push(entry);
    grouped.set(entry.key, list);
  }

  const cutoff = monthsBefore(today, settings.poolLastUsedMonths);
  const pool: PoolItemDto[] = [];

  for (const [key, list] of grouped) {
    if (list.length < settings.poolMinEntries) continue;

    const lastUsed = list.reduce((max, entry) => (entry.date > max ? entry.date : max), '');
    if (lastUsed < cutoff) continue;

    // медиана, а не среднее: одна запись в 400 г не должна двигать привычную порцию
    const typical = median(list.map((entry) => entry.amount));
    if (typical <= 0) continue;

    const first = list[0];
    pool.push({
      key,
      kind: first.kind,
      sourceId: first.sourceId,
      name: first.name,
      producer: first.producer,
      baseUnit: first.baseUnit,
      serving: first.serving,
      servingAmount: first.servingAmount,
      meals: usualMeals(list),
      entries: list.length,
      lastUsed,
      typicalAmount: round(typical, 1),
      minAmount: round(typical * settings.minPortionFactor, 1),
      maxAmount: round(typical * settings.maxPortionFactor, 1),
      per: averagePer(list),
    });
  }

  // самые частые впереди: при отборе кандидатов вес даёт именно частота
  return pool.sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, 'ru'));
}

/**
 * Приёмы пищи, в которых продукт правда живёт.
 *
 * Овсянка, съеденная один раз за ужином против пятидесяти завтраков, ужином не
 * становится: доля ниже пятой части считается случайностью.
 */
function usualMeals(entries: PoolEntry[]): MealKey[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.meal, (counts.get(entry.meal) ?? 0) + 1);

  const meals = [...counts.entries()]
    .filter(([, count]) => count / entries.length >= MEAL_SHARE_FLOOR)
    .sort((a, b) => b[1] - a[1])
    .map(([meal]) => meal as MealKey);

  // если доли не набрал ни один приём, продукт остаётся при самом частом
  if (meals.length > 0) return meals;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? [best[0] as MealKey] : [];
}

/**
 * Питательность на единицу.
 *
 * У продукта она одна во всех записях, но карточка в кэше могла обновиться, а
 * старые записи считались по прежней. Среднее сглаживает это, не давая одной
 * свежей записи переписать историю.
 */
function averagePer(entries: PoolEntry[]): PerUnitDto {
  const mean = (pick: (per: PerUnitDto) => number): number => {
    const values = entries.map((entry) => pick(entry.per)).filter((value) => Number.isFinite(value));
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    energyKcal: mean((per) => per.energyKcal),
    proteinG: mean((per) => per.proteinG),
    carbsG: mean((per) => per.carbsG),
    fatG: mean((per) => per.fatG),
    fiberG: mean((per) => per.fiberG),
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function monthsBefore(date: string, months: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() - months);
  return at.toISOString().slice(0, 10);
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
