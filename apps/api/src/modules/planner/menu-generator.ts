import {
  MEAL_SOURCES,
  message,
  type AlgorithmSettingsDto,
  type Message,
  type MacroSetDto,
  type MealComboDto,
  type MealKey,
  type PlannedItemDto,
  type PlannedMealDto,
  type PoolItemDto,
} from '@fatoff/contracts';

/**
 * Подбор меню: набрать заданные КБЖУ из фиксированного списка продуктов.
 *
 * Это задача о наборе с несколькими ограничениями. Она решается направленным
 * поиском — лучевым, с локальной доводкой, — а не языковой моделью: подбор не
 * «старается попасть» в цель, он её решает, и когда сойтись не удалось, говорит
 * об этом прямо, а не выдаёт лучший из неподходящих вариантов
 * (docs/ANALYSIS-NUTRITION.md, § 4).
 *
 * Всё детерминировано: одно зерно — один и тот же план. Случайность нужна
 * только для разнообразия между днями и заходит через зерно, чтобы результат
 * оставался воспроизводимым.
 */

/** Сколько продуктов рассматривается на один приём пищи. */
const CANDIDATE_LIMIT = 80;
/** Шаг граммовки у рецептов: доли порции, а не граммы. */
const RECIPE_STEP = 0.25;

export interface MealTarget {
  meal: MealKey;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  /** Нижняя граница белка для основного приёма; 0 — не проверять. */
  proteinFloorG: number;
}

export interface Totals {
  energy: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface Chosen {
  item: PoolItemDto;
  amount: number;
}

export interface MealSelection {
  meal: MealKey;
  items: Chosen[];
  totals: Totals;
  cost: number;
  /** Чего не удалось добиться: пусто — сошлось. */
  shortfalls: Message[];
  /** Сколько первых позиций закреплено человеком. */
  locked: number;
  /** Комплект, если приём взят из дневника целиком; пусто — собран из блюд. */
  combo?: MealComboDto | null;
}

/** Детерминированный генератор: mulberry32, тридцать две строки на воспроизводимость. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Подбор приёма пищи.
 *
 * `pinned` — блюда, поставленные человеком: поиск начинается с них и обязан их
 * сохранить. Задача тогда звучит как «добери остальное вокруг заданного», а не
 * «собери с нуля».
 */
export function selectMeal(
  target: MealTarget,
  pool: PoolItemDto[],
  settings: AlgorithmSettingsDto,
  used: Map<string, number>,
  rng: () => number,
  pinned: Chosen[] = [],
): MealSelection {
  const locked = pinned.slice(0, settings.maxItemsPerMeal);
  const candidates = pickCandidates(target.meal, pool, settings, used, rng).filter(
    (item) => !locked.some((chosen) => chosen.item.key === item.key),
  );

  if (candidates.length === 0 && locked.length === 0) {
    return {
      meal: target.meal,
      items: [],
      totals: zero(),
      cost: Number.POSITIVE_INFINITY,
      locked: 0,
      shortfalls: [message('meal.no-candidates', { meal: target.meal })],
    };
  }

  let beam: Chosen[][] = [locked];
  let best: Chosen[] | null = locked.length >= settings.minItemsPerMeal ? locked : null;
  let bestCost = best ? costOf(best, target, settings, used) : Number.POSITIVE_INFINITY;

  for (let depth = locked.length; depth < settings.maxItemsPerMeal; depth++) {
    const next: Array<{ items: Chosen[]; cost: number }> = [];

    for (const partial of beam) {
      const taken = new Set(partial.map((chosen) => chosen.item.key));
      const totals = sum(partial);

      for (const item of candidates) {
        if (taken.has(item.key)) continue;

        for (const amount of amountOptions(item, target, totals, settings)) {
          const items = [...partial, { item, amount }];
          next.push({ items, cost: costOf(items, target, settings, used) });
        }
      }
    }

    if (next.length === 0) break;

    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, settings.beamWidth).map((state) => state.items);

    // полным считается набор от минимального числа позиций
    for (const state of next) {
      if (state.items.length >= settings.minItemsPerMeal && state.cost < bestCost) {
        bestCost = state.cost;
        best = state.items;
      }
    }
  }

  let items = best ?? beam[0] ?? locked;
  for (let pass = 0; pass < settings.localSearchPasses; pass++) {
    const improved = improve(items, candidates, target, settings, used, locked.length);
    if (improved === items) break;
    items = improved;
  }

  const totals = sum(items);
  return {
    meal: target.meal,
    items,
    totals,
    cost: costOf(items, target, settings, used),
    shortfalls: checkMeal(target, totals, settings),
    locked: locked.length,
  };
}

/**
 * Подбор приёма пищи комплектом.
 *
 * Основной путь генератора. Вместо того чтобы набирать обед из четырёх блюд,
 * которые вместе никто не ел, берётся обед, который она правда съела: тот же
 * состав, те же пропорции. Подгонка под цель идёт одним коэффициентом на весь
 * комплект — порция целиком больше или меньше, — и он не выходит за привычные
 * границы порции.
 *
 * Возвращает `null`, когда каталога для этого приёма нет вовсе: тогда зовущий
 * собирает приём из блюд.
 */
export function selectCombo(
  target: MealTarget,
  combos: MealComboDto[],
  byKey: Map<string, PoolItemDto>,
  settings: AlgorithmSettingsDto,
  used: Map<string, number>,
  usedCombos: Map<string, number>,
): MealSelection | null {
  const catalogue = combosFor(target.meal, combos);
  if (catalogue.length === 0) return null;

  // съеденный на неделе комплект берётся снова, только если других не осталось
  const fresh = catalogue.filter((combo) => !usedCombos.has(combo.key));
  const considered = fresh.length > 0 ? fresh : catalogue;

  let best: { combo: MealComboDto; items: Chosen[] } | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const combo of considered) {
    for (const factor of factorOptions(combo, target, settings)) {
      const items = materialize(combo, byKey, factor, settings);
      if (items.length === 0) continue;

      const repeats = usedCombos.get(combo.key) ?? 0;
      const cost =
        costOf(items, target, settings, used, false) +
        (settings.weights.repeat * repeats) / Math.max(1, settings.maxRepeats);

      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = { combo, items };
      }
    }
  }

  if (best === null) return null;

  const totals = sum(best.items);
  return {
    meal: target.meal,
    items: best.items,
    totals,
    cost: bestCost,
    shortfalls: checkMeal(target, totals, settings),
    locked: 0,
    combo: best.combo,
  };
}

/**
 * Перекус: самый лёгкий из её перекусов.
 *
 * У перекуса нет цели по калорийности — у него правило. Всё, что он не съел,
 * достаётся завтраку, обеду и ужину, поэтому «попасть в долю» ему незачем, а
 * выбирать есть из чего: разнообразие даёт запрет повторяться в окне, а не
 * случайность.
 */
export function selectLightestCombo(
  meal: MealKey,
  combos: MealComboDto[],
  byKey: Map<string, PoolItemDto>,
  settings: AlgorithmSettingsDto,
  usedCombos: Map<string, number>,
): MealSelection | null {
  const catalogue = combosFor(meal, combos);
  if (catalogue.length === 0) return null;

  const fresh = catalogue.filter((combo) => !usedCombos.has(combo.key));
  const considered = fresh.length > 0 ? fresh : catalogue;

  let best: { combo: MealComboDto; items: Chosen[]; energy: number } | null = null;

  for (const combo of considered) {
    const items = materialize(combo, byKey, 1, settings);
    if (items.length === 0) continue;

    const energy = sum(items).energy;
    // при равной калорийности выигрывает тот, что раньше в каталоге: порядок там
    // задан частотой и датой, а не случайностью
    if (best === null || energy < best.energy - 1e-9) best = { combo, items, energy };
  }

  if (best === null) return null;

  return {
    meal,
    items: best.items,
    totals: sum(best.items),
    cost: best.energy,
    shortfalls: [],
    locked: 0,
    combo: best.combo,
  };
}

/** Комплекты, годные для этого приёма: завтрак только свой, обед и ужин общие. */
function combosFor(meal: MealKey, combos: MealComboDto[]): MealComboDto[] {
  const sources = MEAL_SOURCES[meal] ?? [meal];
  return combos.filter((combo) => sources.includes(combo.meal));
}

/**
 * Во сколько раз взять комплект.
 *
 * Один коэффициент на все блюда: состав тем и ценен, что съеден вместе, и
 * менять внутри него пропорции значит собирать заново. Границы те же, что у
 * отдельной порции, — полтора её обеда это обед, а три уже нет.
 */
function factorOptions(
  combo: MealComboDto,
  target: MealTarget,
  settings: AlgorithmSettingsDto,
): number[] {
  const options = new Set<number>([1]);
  const add = (raw: number): void => {
    if (!Number.isFinite(raw) || raw <= 0) return;
    options.add(clamp(raw, settings.minPortionFactor, settings.maxPortionFactor));
  };

  if (combo.totals.energyKcal > 0) add(target.energyKcal / combo.totals.energyKcal);
  if (combo.totals.proteinG > 0) {
    add(Math.max(target.proteinG, target.proteinFloorG) / combo.totals.proteinG);
  }

  return [...options];
}

/** Комплект в граммовках: блюда пула, умноженные на коэффициент и округлённые. */
function materialize(
  combo: MealComboDto,
  byKey: Map<string, PoolItemDto>,
  factor: number,
  settings: AlgorithmSettingsDto,
): Chosen[] {
  const items: Chosen[] = [];

  for (const entry of combo.items) {
    const item = byKey.get(entry.key);
    // блюдо выпало из пула — комплект больше не собрать, и половинки не берём
    if (!item) return [];
    items.push({ item, amount: roundAmount(item, entry.amount * factor, settings) });
  }

  return items;
}

/**
 * Локальная доводка: заменить одну позицию или пересчитать её граммовку.
 *
 * Лучевой поиск набирает состав жадно и может застрять на наборе, где одна
 * позиция мешает остальным. Один проход замен обычно снимает половину остатка
 * отклонения — при этом стоит он копейки против самого поиска.
 */
function improve(
  items: Chosen[],
  candidates: PoolItemDto[],
  target: MealTarget,
  settings: AlgorithmSettingsDto,
  used: Map<string, number>,
  locked = 0,
): Chosen[] {
  let best = items;
  let bestCost = costOf(items, target, settings, used);

  // закреплённые позиции стоят первыми и доводке не подлежат
  for (let index = locked; index < items.length; index++) {
    const rest = items.filter((_, i) => i !== index);
    const restTotals = sum(rest);
    const taken = new Set(rest.map((chosen) => chosen.item.key));

    // сначала другая граммовка той же позиции, потом другая позиция
    for (const item of [items[index].item, ...candidates]) {
      if (item.key !== items[index].item.key && taken.has(item.key)) continue;

      for (const amount of amountOptions(item, target, restTotals, settings)) {
        const trial = [...rest];
        trial.splice(index, 0, { item, amount });
        const cost = costOf(trial, target, settings, used);
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          best = trial;
        }
      }
    }
  }

  return best;
}

/**
 * Граммовки-кандидаты: под остаток энергии, под остаток белка и привычная.
 *
 * Целиться только по энергии мало — тогда белковые продукты приходят в
 * случайных количествах; целиться только по белку значит промахиваться по
 * калорийности. Три варианта стоят три вычисления, а выбирает между ними общая
 * оценка набора.
 */
function amountOptions(
  item: PoolItemDto,
  target: MealTarget,
  totals: Totals,
  settings: AlgorithmSettingsDto,
): number[] {
  const options = new Set<number>();
  const add = (raw: number): void => {
    if (!Number.isFinite(raw) || raw <= 0) return;
    options.add(roundAmount(item, clamp(raw, item.minAmount, item.maxAmount), settings));
  };

  add(item.typicalAmount);
  if (item.per.energyKcal > 0) add((target.energyKcal - totals.energy) / item.per.energyKcal);
  if (item.per.proteinG > 0) {
    const want = Math.max(target.proteinG, target.proteinFloorG) - totals.protein;
    add(want / item.per.proteinG);
  }

  return [...options];
}

/** Округление: у рецептов доли порции, у продуктов — шаг из настроек или своя порция. */
function roundAmount(item: PoolItemDto, amount: number, settings: AlgorithmSettingsDto): number {
  if (item.kind === 'recipe') {
    return Math.max(RECIPE_STEP, Math.round(amount / RECIPE_STEP) * RECIPE_STEP);
  }

  // порция берётся шагом, только если она вообще помещается в привычное количество:
  // округлять 125 г до «яблока» в 150 г значит менять порцию, а не округлять её
  const serving = item.servingAmount;
  const step =
    serving && serving > 0 && serving <= item.typicalAmount ? serving : settings.roundToG;

  return Math.max(step, Math.round(amount / step) * step);
}

/**
 * Оценка набора: взвешенная сумма относительных отклонений.
 *
 * Относительных, а не абсолютных, — иначе вес у калорий и у жиров означал бы
 * разное: тысяча килокалорий и сорок граммов жира не сравниваются напрямую.
 */
function costOf(
  items: Chosen[],
  target: MealTarget,
  settings: AlgorithmSettingsDto,
  used: Map<string, number>,
  penalizeItems = true,
): number {
  const totals = sum(items);
  const weights = settings.weights;
  const rel = (actual: number, want: number): number => (want > 0 ? Math.abs(actual - want) / want : 0);

  let cost =
    weights.energy * rel(totals.energy, target.energyKcal) +
    weights.protein * rel(totals.protein, target.proteinG) +
    weights.carbs * rel(totals.carbs, target.carbsG) +
    weights.fat * rel(totals.fat, target.fatG);

  // клетчатка считается только в минус: съесть её больше нормы проблемой не считается
  if (target.fiberG > 0 && totals.fiber < target.fiberG) {
    cost += (weights.fiber * (target.fiberG - totals.fiber)) / target.fiberG;
  }

  // порог белка за приём — не пожелание: ниже него отклик неполный, и стоит это дороже
  if (target.proteinFloorG > 0 && totals.protein < target.proteinFloorG) {
    cost += (weights.protein * 2 * (target.proteinFloorG - totals.protein)) / target.proteinFloorG;
  }

  // состав комплекта выбирали не мы: считать ему позиции значило бы наказывать
  // её обед за то, что он из четырёх блюд, а не из двух
  if (penalizeItems) cost += (weights.items * items.length) / Math.max(1, settings.maxItemsPerMeal);

  const repeats = items.reduce((count, chosen) => count + (used.get(chosen.item.key) ?? 0), 0);
  cost += (weights.repeat * repeats) / Math.max(1, settings.maxRepeats * settings.maxItemsPerMeal);

  return cost;
}

/**
 * Кандидаты на приём пищи.
 *
 * Взвешенная выборка без возврата: чем чаще она этот продукт ела, тем выше шанс
 * увидеть его в наборе. Разнообразие между днями даёт зерно, а не перебор всего
 * пула на каждый приём — на трёх сотнях продуктов это разница в секунды.
 */
export function pickCandidates(
  meal: MealKey,
  pool: PoolItemDto[],
  settings: AlgorithmSettingsDto,
  used: Map<string, number>,
  rng: () => number,
): PoolItemDto[] {
  const sources = MEAL_SOURCES[meal] ?? [meal];
  const eligible = pool.filter(
    (item) =>
      item.meals.some((source) => sources.includes(source)) &&
      (used.get(item.key) ?? 0) < settings.maxRepeats,
  );
  if (eligible.length <= CANDIDATE_LIMIT) return eligible;

  const remaining = [...eligible];
  const picked: PoolItemDto[] = [];

  while (picked.length < CANDIDATE_LIMIT && remaining.length > 0) {
    const total = remaining.reduce((sum, item) => sum + item.entries, 0);
    let roll = rng() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i].entries;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return picked;
}

function checkMeal(target: MealTarget, totals: Totals, settings: AlgorithmSettingsDto): Message[] {
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

export function sum(items: Chosen[]): Totals {
  const totals = zero();
  for (const { item, amount } of items) {
    totals.energy += item.per.energyKcal * amount;
    totals.protein += item.per.proteinG * amount;
    totals.carbs += item.per.carbsG * amount;
    totals.fat += item.per.fatG * amount;
    totals.fiber += item.per.fiberG * amount;
  }
  return totals;
}

export function zero(): Totals {
  return { energy: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
}

/** Перевод выбора в то, что уедет наружу: с граммовкой, порциями и КБЖУ каждой позиции. */
export function toPlannedMeal(selection: MealSelection, target: MealTarget): PlannedMealDto {
  const items: PlannedItemDto[] = selection.items.map(({ item, amount }, index) => ({
    key: item.key,
    pinned: index < selection.locked,
    name: item.name,
    amount: round(amount, 2),
    // единица — ключ, а не подпись: её переводит тот, кто показывает
    unit: item.kind === 'recipe' ? 'portion' : (item.baseUnit ?? 'g'),
    serving: item.serving,
    servings:
      item.servingAmount && item.servingAmount > 0 ? round(amount / item.servingAmount, 2) : null,
    energyKcal: round(item.per.energyKcal * amount),
    proteinG: round(item.per.proteinG * amount, 1),
    carbsG: round(item.per.carbsG * amount, 1),
    fatG: round(item.per.fatG * amount, 1),
    fiberG: round(item.per.fiberG * amount, 1),
  }));

  const totals: MacroSetDto = {
    energyKcal: round(selection.totals.energy),
    proteinG: round(selection.totals.protein, 1),
    carbsG: round(selection.totals.carbs, 1),
    fatG: round(selection.totals.fat, 1),
    fiberG: round(selection.totals.fiber, 1),
  };

  return {
    meal: selection.meal,
    targetKcal: round(target.energyKcal),
    targetProteinG: round(target.proteinG, 1),
    items,
    totals,
    comboFrom: selection.combo?.from ?? null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
