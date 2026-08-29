import { DATASET_REQUIRES, DATASETS, type Dataset } from '@fatoff/contracts';

import { addDays, dateRange } from '../../common/date.util';

/** Дневные итоги: и то, что уже лежит в базе, и то, что сейчас сказал YAZIO. */
export interface DayTotals {
  date: string;
  energy: number;
  carb: number;
  protein: number;
  fat: number;
  energyGoal: number;
}

export interface StoredDay extends DayTotals {
  /** Есть ли сырой снимок дня. Итоги могут быть, а подробностей ещё нет. */
  hasSnapshot: boolean;
}

export type PlanReason = 'new' | 'changed' | 'recent' | 'forced';

export interface DayPlan {
  date: string;
  reason: PlanReason;
}

export interface PlanInput {
  from: string;
  to: string;
  /** Ответ `nutrients-daily` за период. */
  remote: DayTotals[];
  /** Что уже есть в базе. */
  stored: StoredDay[];
  /** Сегодняшняя дата — от неё считается хвост перепроверки. */
  today: string;
  resyncDays: number;
  /** Пройти каждую дату периода, а не только те, о которых YAZIO сообщил данные. */
  allDays: boolean;
  force: boolean;
}

/**
 * Итоги считаются разошедшимися при отличии больше сотой доли: числа приходят
 * с плавающей точкой, и сравнение на строгое равенство давало бы перекачку
 * всей истории на каждом запуске.
 */
const DIFFERS = 0.01;

function totalsDiffer(a: DayTotals, b: DayTotals): boolean {
  return (
    Math.abs(a.energy - b.energy) > DIFFERS ||
    Math.abs(a.carb - b.carb) > DIFFERS ||
    Math.abs(a.protein - b.protein) > DIFFERS ||
    Math.abs(a.fat - b.fat) > DIFFERS ||
    Math.abs(a.energyGoal - b.energyGoal) > DIFFERS
  );
}

/**
 * Какие дни надо перекачать (D-012).
 *
 * Дешёвый запрос `nutrients-daily` отдаёт итоги за весь период разом, и
 * сравнение с сохранёнными даёт точный список изменившегося. Хвост последних
 * дней входит всегда: сегодняшний день меняется прямо сейчас, а вчерашний
 * дописывают утром.
 */
export function planDays(input: PlanInput): DayPlan[] {
  const { from, to, remote, stored, today, resyncDays, allDays, force } = input;

  const storedByDate = new Map(stored.map((day) => [day.date, day]));
  const remoteByDate = new Map(remote.map((day) => [day.date, day]));

  // хвост перепроверки берётся от сегодняшнего дня, но не выходит за период:
  // при выгрузке прошлого года перепроверять нечего
  const recentFrom = resyncDays > 0 ? addDays(today, -(resyncDays - 1)) : null;

  const candidates = allDays
    ? dateRange(from, to)
    : [
        ...new Set([
          ...remoteByDate.keys(),
          ...(recentFrom ? dateRange(recentFrom, today) : []),
        ]),
      ]
        .filter((date) => date >= from && date <= to)
        .sort();

  const plan: DayPlan[] = [];
  for (const date of candidates) {
    const known = storedByDate.get(date);
    const fresh = remoteByDate.get(date);

    if (force) {
      plan.push({ date, reason: 'forced' });
      continue;
    }
    if (!known?.hasSnapshot) {
      plan.push({ date, reason: 'new' });
      continue;
    }
    if (fresh && totalsDiffer(known, fresh)) {
      plan.push({ date, reason: 'changed' });
      continue;
    }
    if (recentFrom && date >= recentFrom && date <= today) {
      plan.push({ date, reason: 'recent' });
    }
  }

  return plan;
}

/**
 * Дополняет выбор датасетов теми, без которых он бессмыслен: карточки продуктов
 * и рецептов не нужны никому, кроме дневника, и без дневника их неоткуда взять.
 */
export function resolveDatasets(selected?: Dataset[]): Dataset[] {
  const chosen = new Set<Dataset>(selected?.length ? selected : DATASETS);

  let added = true;
  while (added) {
    added = false;
    for (const dataset of [...chosen]) {
      for (const required of DATASET_REQUIRES[dataset] ?? []) {
        if (!chosen.has(required)) {
          chosen.add(required);
          added = true;
        }
      }
    }
  }

  return DATASETS.filter((dataset) => chosen.has(dataset));
}
