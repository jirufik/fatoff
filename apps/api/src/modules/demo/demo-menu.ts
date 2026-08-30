import { macrosOf, recipeMacros, QUICK_ADDS } from './demo-pantry';

/**
 * Из чего складывается день демо-героини.
 *
 * Меню собирается из готовых наборов, а не из случайных продуктов: случайный
 * набор даёт «двести грамм миндаля на завтрак», и демо перестаёт быть похожим
 * на правду. Наборов по четыре на приём пищи — этого хватает, чтобы за полгода
 * не мозолил глаза один и тот же завтрак, и мало, чтобы каждый оставался
 * осмысленным.
 *
 * Под целевую калорийность дня порции подтягиваются множителем — так же, как
 * человек кладёт себе побольше или поменьше. Множитель ограничен: за его
 * пределами еда перестаёт быть едой и превращается в арифметику.
 */

export interface MenuEntry {
  kind: 'product' | 'recipe' | 'quick';
  id: string;
  meal: string;
  /** Минута суток: у записей дневника есть время, и оно видно в дне. */
  atMin: number;
  /** Граммы для продукта, порции для рецепта. */
  amount: number;
}

export interface DayMenu {
  entries: MenuEntry[];
  kcal: number;
  carb: number;
  protein: number;
  fat: number;
  fiber: number;
}

interface Part {
  product: string;
  grams: number;
}

interface Template {
  parts?: Part[];
  recipe?: { id: string; portions: number };
}

const BREAKFASTS: Template[] = [
  {
    parts: [
      { product: 'demo-oatmeal', grams: 60 },
      { product: 'demo-milk', grams: 200 },
      { product: 'demo-banana', grams: 120 },
      { product: 'demo-almonds', grams: 15 },
    ],
  },
  { recipe: { id: 'demo-syrniki', portions: 1 }, parts: [{ product: 'demo-berries', grams: 90 }] },
  {
    parts: [
      { product: 'demo-egg', grams: 110 },
      { product: 'demo-bread', grams: 70 },
      { product: 'demo-avocado', grams: 55 },
      { product: 'demo-tomato', grams: 90 },
    ],
  },
  {
    parts: [
      { product: 'demo-cottage', grams: 180 },
      { product: 'demo-berries', grams: 100 },
      { product: 'demo-almonds', grams: 12 },
    ],
  },
  // бутерброд и кофе: клетчатки почти нет, и день это заметит
  {
    parts: [
      { product: 'demo-bread', grams: 70 },
      { product: 'demo-cheese', grams: 40 },
      { product: 'demo-egg', grams: 55 },
    ],
  },
];

const LUNCHES: Template[] = [
  {
    parts: [
      { product: 'demo-chicken', grams: 160 },
      { product: 'demo-rice', grams: 180 },
      { product: 'demo-broccoli', grams: 120 },
      { product: 'demo-oliveoil', grams: 8 },
    ],
  },
  { recipe: { id: 'demo-salad', portions: 1 }, parts: [{ product: 'demo-bread', grams: 35 }] },
  {
    recipe: { id: 'demo-soup', portions: 1 },
    parts: [
      { product: 'demo-bread', grams: 70 },
      { product: 'demo-cheese', grams: 25 },
    ],
  },
  {
    parts: [
      { product: 'demo-turkey', grams: 140 },
      { product: 'demo-buckwheat', grams: 200 },
      { product: 'demo-cucumber', grams: 100 },
      { product: 'demo-oliveoil', grams: 7 },
    ],
  },
  // обед из столовой: паста с сыром, овощей не досталось
  {
    parts: [
      { product: 'demo-pasta', grams: 220 },
      { product: 'demo-chicken', grams: 120 },
      { product: 'demo-cheese', grams: 30 },
    ],
  },
];

const DINNERS: Template[] = [
  {
    parts: [
      { product: 'demo-salmon', grams: 150 },
      { product: 'demo-potato', grams: 200 },
      { product: 'demo-lettuce', grams: 80 },
      { product: 'demo-oliveoil', grams: 7 },
    ],
  },
  { recipe: { id: 'demo-bolognese', portions: 1 } },
  {
    parts: [
      { product: 'demo-tuna', grams: 120 },
      { product: 'demo-lentils', grams: 150 },
      { product: 'demo-tomato', grams: 100 },
    ],
  },
  {
    parts: [
      { product: 'demo-turkey', grams: 150 },
      { product: 'demo-broccoli', grams: 200 },
      { product: 'demo-rice', grams: 120 },
    ],
  },
];

const SNACKS: Template[] = [
  {
    parts: [
      { product: 'demo-apple', grams: 180 },
      { product: 'demo-almonds', grams: 20 },
    ],
  },
  { parts: [{ product: 'demo-bar', grams: 50 }] },
  {
    parts: [
      { product: 'demo-kefir', grams: 250 },
      { product: 'demo-banana', grams: 110 },
    ],
  },
  {
    parts: [
      { product: 'demo-chocolate', grams: 25 },
      { product: 'demo-orange', grams: 200 },
    ],
  },
];

/**
 * Дни, когда всё пошло не по плану.
 *
 * Ужин из доставки вместо приготовленного, вечерние чипсы вместо яблока. Такие
 * дни нужны демо больше остальных: на ровном дефиците оценка дня всегда зелёная
 * и не показывает ничего. Здесь же проседают и белок, и клетчатка — то есть
 * ровно то, ради чего оценка вообще считается из шести составляющих (D-068).
 */
const SPLURGE_DINNERS = ['demo-pizza', 'demo-burger'] as const;
const SPLURGE_SNACKS = ['demo-icecream', 'demo-chips'] as const;

const MEALS: Array<{ meal: string; atMin: number; templates: Template[] }> = [
  { meal: 'breakfast', atMin: 8 * 60 + 10, templates: BREAKFASTS },
  { meal: 'lunch', atMin: 13 * 60 + 20, templates: LUNCHES },
  { meal: 'snack', atMin: 16 * 60 + 40, templates: SNACKS },
  { meal: 'dinner', atMin: 19 * 60 + 30, templates: DINNERS },
];

/** Границы подтягивания порций: дальше еда превращается в арифметику. */
const SCALE_MIN = 0.72;
const SCALE_MAX = 1.32;

/**
 * В день срыва нижняя граница ниже: пицца занимает половину дневной нормы, и
 * остальные приёмы пищи в такой день действительно съёживаются — на завтрак
 * кофе, обед пропущен. Без этого набор не сходится с целью дня, а цель — это
 * то, из чего считается вес: разойдясь здесь, демо начнёт спорить само с собой.
 */
const SCALE_MIN_SPLURGE = 0.42;

const pick = <T>(items: T[], random: () => number): T => items[Math.floor(random() * items.length)]!;

/**
 * Собрать день под целевую калорийность.
 *
 * Сначала берутся наборы, потом считается, во сколько раз промахнулись, и на
 * этот множитель домножаются граммы продуктов. Порции рецептов и быстрые записи
 * не трогаются: рецепт кладут порциями, а «кусок пирога» — это кусок пирога.
 */
export function buildMenu(
  targetKcal: number,
  weekend: boolean,
  splurge: boolean,
  random: () => number,
): DayMenu {
  // в день срыва ужин и перекус приезжают в коробке, а не готовятся
  const chosen = MEALS.filter((meal) => !(splurge && ['dinner', 'snack'].includes(meal.meal))).map(
    (meal) => ({ ...meal, template: pick(meal.templates, random) }),
  );

  // быстрые записи: кофе по будням, вино и кусок пирога — в выходные
  const quick: MenuEntry[] = [];
  if (splurge) {
    quick.push({
      kind: 'quick',
      id: pick([...SPLURGE_DINNERS], random),
      meal: 'dinner',
      atMin: 20 * 60,
      amount: 1,
    });
    quick.push({
      kind: 'quick',
      id: pick([...SPLURGE_SNACKS], random),
      meal: 'snack',
      atMin: 22 * 60 + 10,
      amount: 1,
    });
  }
  if (!weekend && random() < 0.55) {
    quick.push({ kind: 'quick', id: 'demo-coffee', meal: 'breakfast', atMin: 10 * 60 + 15, amount: 1 });
  }
  if (weekend && random() < 0.5) {
    quick.push({ kind: 'quick', id: 'demo-wine', meal: 'dinner', atMin: 20 * 60 + 40, amount: 1 });
  }
  if (random() < 0.12) {
    quick.push({ kind: 'quick', id: 'demo-pastry', meal: 'snack', atMin: 15 * 60 + 30, amount: 1 });
  }

  const fixed = [
    ...chosen.flatMap(({ template }) =>
      template.recipe ? [recipeMacros(template.recipe.id, template.recipe.portions)] : [],
    ),
    ...quick.map((entry) => QUICK_ADDS.find((item) => item.id === entry.id)!.macros),
  ];
  const fixedKcal = fixed.reduce((sum, macros) => sum + macros.kcal, 0);

  const flexible = chosen.flatMap(({ meal, atMin, template }) =>
    (template.parts ?? []).map((part) => ({ meal, atMin, part })),
  );
  const flexibleKcal = flexible.reduce((sum, item) => sum + macrosOf(item.part.product, item.part.grams).kcal, 0);

  const wanted = targetKcal - fixedKcal;
  const floor = splurge ? SCALE_MIN_SPLURGE : SCALE_MIN;
  const scale = flexibleKcal > 0 ? Math.min(SCALE_MAX, Math.max(floor, wanted / flexibleKcal)) : 1;

  const entries: MenuEntry[] = [];
  let kcal = 0;
  let carb = 0;
  let protein = 0;
  let fat = 0;
  let fiber = 0;
  const add = (macros: { kcal: number; carb: number; protein: number; fat: number; fiber: number }): void => {
    kcal += macros.kcal;
    carb += macros.carb;
    protein += macros.protein;
    fat += macros.fat;
    fiber += macros.fiber;
  };

  for (const { meal, atMin, template } of chosen) {
    if (template.recipe) {
      entries.push({
        kind: 'recipe',
        id: template.recipe.id,
        meal,
        atMin,
        amount: template.recipe.portions,
      });
      add(recipeMacros(template.recipe.id, template.recipe.portions));
    }
  }

  for (const { meal, atMin, part } of flexible) {
    // граммы кратны пяти: в дневнике их набирают руками, а не микроскопом
    const grams = Math.max(5, Math.round((part.grams * scale) / 5) * 5);
    entries.push({ kind: 'product', id: part.product, meal, atMin, amount: grams });
    add(macrosOf(part.product, grams));
  }

  for (const entry of quick) {
    entries.push(entry);
    add(QUICK_ADDS.find((item) => item.id === entry.id)!.macros);
  }

  entries.sort((left, right) => left.atMin - right.atMin);
  return { entries, kcal, carb, protein, fat, fiber };
}
