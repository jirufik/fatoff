import type { NutrientMap, YazioProduct, YazioRecipe } from '../yazio/yazio.types';

/**
 * Кладовая демо-аккаунта: еда, из которой собираются дни.
 *
 * Значения — на 100 грамм, как на упаковке: так их можно сверить глазами с
 * любой этикеткой. YAZIO хранит нутриенты на одну базовую единицу, поэтому при
 * сборке карточки всё делится на сто — ровно один раз и в одном месте.
 *
 * Названия еды не переводятся ни в демо, ни у настоящего аккаунта: их пишет
 * человек в своём приложении. Поэтому у каждой позиции два имени, и берётся то,
 * на языке которого демо создавали (D-068).
 */

export type DemoLocale = 'ru' | 'en';

interface Per100 {
  kcal: number;
  carb: number;
  protein: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  salt?: number;
}

interface PantryItem {
  id: string;
  ru: string;
  en: string;
  unit: 'g' | 'ml';
  per100: Per100;
  /** Домашняя мера: штука, ложка, стакан. */
  serving?: { name: string; amount: number };
  producer?: { ru: string; en: string };
  /** Своя карточка, а не из базы YAZIO: у такой нет ни штрихкода, ни проверки. */
  own?: boolean;
}

const PANTRY: PantryItem[] = [
  // ── крупы, хлеб, гарниры ──────────────────────────────────────────────────
  {
    id: 'demo-oatmeal',
    ru: 'Овсяные хлопья',
    en: 'Rolled oats',
    unit: 'g',
    per100: { kcal: 370, carb: 60, protein: 12.5, fat: 7, fiber: 10 },
  },
  {
    id: 'demo-bread',
    ru: 'Хлеб цельнозерновой',
    en: 'Wholegrain bread',
    unit: 'g',
    per100: { kcal: 247, carb: 41, protein: 13, fat: 3.4, fiber: 7, salt: 1.2 },
    serving: { name: 'slice', amount: 35 },
  },
  {
    id: 'demo-rice',
    ru: 'Рис бурый, отварной',
    en: 'Brown rice, cooked',
    unit: 'g',
    per100: { kcal: 123, carb: 25.6, protein: 2.7, fat: 1, fiber: 1.8 },
  },
  {
    id: 'demo-buckwheat',
    ru: 'Гречка отварная',
    en: 'Buckwheat, cooked',
    unit: 'g',
    per100: { kcal: 110, carb: 21, protein: 4, fat: 1.1, fiber: 2.7 },
  },
  {
    id: 'demo-pasta',
    ru: 'Паста отварная',
    en: 'Pasta, cooked',
    unit: 'g',
    per100: { kcal: 158, carb: 31, protein: 5.8, fat: 0.9, fiber: 1.8 },
  },
  {
    id: 'demo-potato',
    ru: 'Картофель отварной',
    en: 'Boiled potato',
    unit: 'g',
    per100: { kcal: 87, carb: 20, protein: 2, fat: 0.1, fiber: 1.8 },
  },

  // ── белок ─────────────────────────────────────────────────────────────────
  {
    id: 'demo-chicken',
    ru: 'Куриная грудка',
    en: 'Chicken breast',
    unit: 'g',
    per100: { kcal: 165, carb: 0, protein: 31, fat: 3.6 },
  },
  {
    id: 'demo-turkey',
    ru: 'Индейка, филе',
    en: 'Turkey breast',
    unit: 'g',
    per100: { kcal: 135, carb: 0, protein: 29, fat: 2 },
  },
  {
    id: 'demo-salmon',
    ru: 'Лосось',
    en: 'Salmon',
    unit: 'g',
    per100: { kcal: 208, carb: 0, protein: 20, fat: 13 },
  },
  {
    id: 'demo-tuna',
    ru: 'Тунец консервированный',
    en: 'Canned tuna',
    unit: 'g',
    per100: { kcal: 116, carb: 0, protein: 26, fat: 1, salt: 0.9 },
  },
  {
    id: 'demo-egg',
    ru: 'Яйцо куриное',
    en: 'Egg',
    unit: 'g',
    per100: { kcal: 155, carb: 1.1, protein: 13, fat: 11 },
    serving: { name: 'piece', amount: 55 },
  },
  {
    id: 'demo-cottage',
    ru: 'Творог 5%',
    en: 'Cottage cheese 5%',
    unit: 'g',
    per100: { kcal: 121, carb: 3, protein: 17, fat: 5 },
  },
  {
    id: 'demo-yoghurt',
    ru: 'Йогурт греческий 2%',
    en: 'Greek yoghurt 2%',
    unit: 'g',
    per100: { kcal: 73, carb: 3.6, protein: 10, fat: 2 },
  },
  {
    id: 'demo-kefir',
    ru: 'Кефир 1%',
    en: 'Kefir 1%',
    unit: 'ml',
    per100: { kcal: 40, carb: 4, protein: 3, fat: 1 },
  },
  {
    id: 'demo-cheese',
    ru: 'Сыр твёрдый',
    en: 'Hard cheese',
    unit: 'g',
    per100: { kcal: 350, carb: 0.5, protein: 25, fat: 27, salt: 1.8 },
  },
  {
    id: 'demo-lentils',
    ru: 'Чечевица отварная',
    en: 'Lentils, cooked',
    unit: 'g',
    per100: { kcal: 116, carb: 20, protein: 9, fat: 0.4, fiber: 8 },
  },

  // ── овощи и фрукты ────────────────────────────────────────────────────────
  {
    id: 'demo-banana',
    ru: 'Банан',
    en: 'Banana',
    unit: 'g',
    per100: { kcal: 89, carb: 21, protein: 1.1, fat: 0.3, fiber: 2.6, sugar: 12 },
    serving: { name: 'piece', amount: 120 },
  },
  {
    id: 'demo-apple',
    ru: 'Яблоко',
    en: 'Apple',
    unit: 'g',
    per100: { kcal: 52, carb: 14, protein: 0.3, fat: 0.2, fiber: 2.4, sugar: 10 },
    serving: { name: 'piece', amount: 180 },
  },
  {
    id: 'demo-orange',
    ru: 'Апельсин',
    en: 'Orange',
    unit: 'g',
    per100: { kcal: 47, carb: 12, protein: 0.9, fat: 0.1, fiber: 2.4, sugar: 9 },
    serving: { name: 'piece', amount: 200 },
  },
  {
    id: 'demo-berries',
    ru: 'Ягоды замороженные',
    en: 'Frozen berries',
    unit: 'g',
    per100: { kcal: 44, carb: 8, protein: 0.8, fat: 0.4, fiber: 4 },
  },
  {
    id: 'demo-cucumber',
    ru: 'Огурец',
    en: 'Cucumber',
    unit: 'g',
    per100: { kcal: 15, carb: 3.6, protein: 0.7, fat: 0.1, fiber: 0.5 },
  },
  {
    id: 'demo-tomato',
    ru: 'Помидор',
    en: 'Tomato',
    unit: 'g',
    per100: { kcal: 18, carb: 3.9, protein: 0.9, fat: 0.2, fiber: 1.2 },
  },
  {
    id: 'demo-lettuce',
    ru: 'Салат листовой',
    en: 'Lettuce',
    unit: 'g',
    per100: { kcal: 15, carb: 2.9, protein: 1.4, fat: 0.2, fiber: 1.3 },
  },
  {
    id: 'demo-broccoli',
    ru: 'Брокколи',
    en: 'Broccoli',
    unit: 'g',
    per100: { kcal: 34, carb: 7, protein: 2.8, fat: 0.4, fiber: 2.6 },
  },
  {
    id: 'demo-avocado',
    ru: 'Авокадо',
    en: 'Avocado',
    unit: 'g',
    per100: { kcal: 160, carb: 8.5, protein: 2, fat: 15, fiber: 6.7 },
  },

  // ── жиры, орехи, сладкое ──────────────────────────────────────────────────
  {
    id: 'demo-oliveoil',
    ru: 'Оливковое масло',
    en: 'Olive oil',
    unit: 'ml',
    per100: { kcal: 884, carb: 0, protein: 0, fat: 100 },
    serving: { name: 'tablespoon', amount: 13 },
    own: true,
  },
  {
    id: 'demo-almonds',
    ru: 'Миндаль',
    en: 'Almonds',
    unit: 'g',
    per100: { kcal: 579, carb: 22, protein: 21, fat: 50, fiber: 12.5 },
  },
  {
    id: 'demo-chocolate',
    ru: 'Шоколад тёмный 70%',
    en: 'Dark chocolate 70%',
    unit: 'g',
    per100: { kcal: 546, carb: 46, protein: 8, fat: 31, fiber: 11, sugar: 24 },
    producer: { ru: 'Своя запись', en: 'Own entry' },
    own: true,
  },
  {
    id: 'demo-bar',
    ru: 'Протеиновый батончик',
    en: 'Protein bar',
    unit: 'g',
    per100: { kcal: 350, carb: 30, protein: 30, fat: 12, fiber: 6 },
    serving: { name: 'piece', amount: 50 },
  },
  {
    id: 'demo-milk',
    ru: 'Молоко 2.5%',
    en: 'Milk 2.5%',
    unit: 'ml',
    per100: { kcal: 52, carb: 4.7, protein: 2.9, fat: 2.5 },
  },
];

const BY_ID = new Map(PANTRY.map((item) => [item.id, item]));

/** Нутриенты YAZIO — на одну базовую единицу, не на сто. */
function nutrientsOf(per100: Per100): NutrientMap {
  const map: NutrientMap = {
    'energy.energy': per100.kcal / 100,
    'nutrient.carb': per100.carb / 100,
    'nutrient.protein': per100.protein / 100,
    'nutrient.fat': per100.fat / 100,
  };
  if (per100.fiber !== undefined) map['nutrient.dietaryfiber'] = per100.fiber / 100;
  if (per100.sugar !== undefined) map['nutrient.sugar'] = per100.sugar / 100;
  if (per100.salt !== undefined) map['nutrient.salt'] = per100.salt / 100;
  return map;
}

/** Карточка продукта в том виде, в каком её кладёт в кэш настоящая выгрузка. */
export function demoProduct(id: string, locale: DemoLocale): { name: string; payload: YazioProduct } {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Нет такого продукта в кладовой демо: ${id}`);

  const name = item[locale];
  return {
    name,
    payload: {
      name,
      producer: item.producer ? item.producer[locale] : null,
      base_unit: item.unit,
      is_verified: !item.own,
      is_private: item.own === true,
      is_deleted: false,
      has_ean: false,
      eans: [],
      countries: [],
      language: locale,
      updated_at: null,
      servings: item.serving ? [{ serving: item.serving.name, amount: item.serving.amount }] : [],
      nutrients: nutrientsOf(item.per100),
    },
  };
}

export const DEMO_PRODUCT_IDS: string[] = PANTRY.map((item) => item.id);

/** Сколько энергии, белка, углеводов, жира и клетчатки в стольки-то граммах. */
export function macrosOf(id: string, grams: number): {
  kcal: number;
  carb: number;
  protein: number;
  fat: number;
  fiber: number;
} {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Нет такого продукта в кладовой демо: ${id}`);
  const k = grams / 100;
  return {
    kcal: item.per100.kcal * k,
    carb: item.per100.carb * k,
    protein: item.per100.protein * k,
    fat: item.per100.fat * k,
    fiber: (item.per100.fiber ?? 0) * k,
  };
}

// ── рецепты ─────────────────────────────────────────────────────────────────

interface RecipeItem {
  id: string;
  ru: string;
  en: string;
  portions: number;
  /** На одну порцию: рецепт в YAZIO так и хранится. */
  perPortion: Per100;
  parts: Array<{ product: string; grams: number }>;
  steps: { ru: string[]; en: string[] };
}

const RECIPES: RecipeItem[] = [
  {
    id: 'demo-soup',
    ru: 'Овощной суп с чечевицей',
    en: 'Lentil vegetable soup',
    portions: 4,
    perPortion: { kcal: 215, carb: 27, protein: 11, fat: 6, fiber: 8 },
    parts: [
      { product: 'demo-lentils', grams: 120 },
      { product: 'demo-tomato', grams: 90 },
      { product: 'demo-oliveoil', grams: 8 },
    ],
    steps: {
      ru: ['Нарезать овощи', 'Варить 25 минут', 'Добавить чечевицу и специи'],
      en: ['Chop the vegetables', 'Simmer for 25 minutes', 'Add lentils and spices'],
    },
  },
  {
    id: 'demo-salad',
    ru: 'Салат с курицей и авокадо',
    en: 'Chicken and avocado salad',
    portions: 2,
    perPortion: { kcal: 340, carb: 9, protein: 32, fat: 20, fiber: 6 },
    parts: [
      { product: 'demo-chicken', grams: 150 },
      { product: 'demo-avocado', grams: 70 },
      { product: 'demo-lettuce', grams: 80 },
      { product: 'demo-oliveoil', grams: 7 },
    ],
    steps: {
      ru: ['Обжарить грудку', 'Нарезать овощи', 'Заправить маслом'],
      en: ['Pan-fry the breast', 'Chop the vegetables', 'Dress with oil'],
    },
  },
  {
    id: 'demo-bolognese',
    ru: 'Паста болоньезе',
    en: 'Pasta bolognese',
    portions: 3,
    perPortion: { kcal: 470, carb: 55, protein: 28, fat: 14, fiber: 5 },
    parts: [
      { product: 'demo-pasta', grams: 180 },
      { product: 'demo-turkey', grams: 120 },
      { product: 'demo-tomato', grams: 150 },
    ],
    steps: {
      ru: ['Отварить пасту', 'Потушить фарш с томатами', 'Соединить'],
      en: ['Boil the pasta', 'Stew the mince with tomatoes', 'Combine'],
    },
  },
  {
    id: 'demo-syrniki',
    ru: 'Сырники творожные',
    en: 'Cottage cheese pancakes',
    portions: 2,
    perPortion: { kcal: 295, carb: 22, protein: 24, fat: 12, fiber: 1 },
    parts: [
      { product: 'demo-cottage', grams: 200 },
      { product: 'demo-egg', grams: 55 },
      { product: 'demo-oliveoil', grams: 6 },
    ],
    steps: {
      ru: ['Смешать творог с яйцом', 'Сформировать', 'Обжарить с двух сторон'],
      en: ['Mix the cheese with egg', 'Shape the pancakes', 'Fry on both sides'],
    },
  },
];

const RECIPE_BY_ID = new Map(RECIPES.map((item) => [item.id, item]));

export const DEMO_RECIPE_IDS: string[] = RECIPES.map((item) => item.id);

/** Рецепт в том виде, в каком его кладёт в кэш настоящая выгрузка. */
export function demoRecipe(id: string, locale: DemoLocale): YazioRecipe {
  const item = RECIPE_BY_ID.get(id);
  if (!item) throw new Error(`Нет такого рецепта в кладовой демо: ${id}`);

  // у рецепта нутриенты уже итоговые на порцию — делить на сто нечего
  const nutrients: NutrientMap = {
    'energy.energy': item.perPortion.kcal,
    'nutrient.carb': item.perPortion.carb,
    'nutrient.protein': item.perPortion.protein,
    'nutrient.fat': item.perPortion.fat,
    'nutrient.dietaryfiber': item.perPortion.fiber ?? 0,
  };

  return {
    name: item[locale],
    locale,
    portion_count: item.portions,
    is_yazio_recipe: false,
    is_pro_recipe: false,
    nutrients,
    servings: item.parts.map((part) => {
      const product = BY_ID.get(part.product);
      return {
        product_id: part.product,
        name: product ? product[locale] : part.product,
        amount: part.grams,
        base_unit: product?.unit ?? 'g',
      };
    }),
    instructions: item.steps[locale],
  };
}

/** Порции рецепта считаются множителем к нутриентам одной порции. */
export function recipeMacros(id: string, portions: number): {
  kcal: number;
  carb: number;
  protein: number;
  fat: number;
  fiber: number;
} {
  const item = RECIPE_BY_ID.get(id);
  if (!item) throw new Error(`Нет такого рецепта в кладовой демо: ${id}`);
  return {
    kcal: item.perPortion.kcal * portions,
    carb: item.perPortion.carb * portions,
    protein: item.perPortion.protein * portions,
    fat: item.perPortion.fat * portions,
    fiber: (item.perPortion.fiber ?? 0) * portions,
  };
}

// ── быстрые записи ──────────────────────────────────────────────────────────

/**
 * Запись «на глаз», без карточки продукта.
 *
 * Такие в дневнике есть у всех: кофе на вынос и что-то с общего стола. Ради них
 * в разборе дневника заведена отдельная ветка, и без них демо не показало бы,
 * как выглядит день целиком.
 */
export const QUICK_ADDS = [
  {
    id: 'demo-pizza',
    ru: 'Пицца, половина',
    en: 'Half a pizza',
    macros: { kcal: 780, carb: 88, protein: 30, fat: 32, fiber: 4 },
  },
  {
    id: 'demo-burger',
    ru: 'Бургер с картошкой фри',
    en: 'Burger and fries',
    macros: { kcal: 950, carb: 95, protein: 35, fat: 48, fiber: 5 },
  },
  {
    id: 'demo-icecream',
    ru: 'Мороженое',
    en: 'Ice cream',
    macros: { kcal: 320, carb: 38, protein: 5, fat: 16, fiber: 0 },
  },
  {
    id: 'demo-chips',
    ru: 'Чипсы',
    en: 'Crisps',
    macros: { kcal: 380, carb: 36, protein: 4, fat: 24, fiber: 2 },
  },
  {
    id: 'demo-coffee',
    ru: 'Капучино на вынос',
    en: 'Cappuccino to go',
    macros: { kcal: 120, carb: 12, protein: 6, fat: 5, fiber: 0 },
  },
  {
    id: 'demo-pastry',
    ru: 'Кусок пирога, у коллеги день рождения',
    en: 'Slice of cake at the office',
    macros: { kcal: 340, carb: 44, protein: 5, fat: 16, fiber: 1 },
  },
  {
    id: 'demo-wine',
    ru: 'Бокал вина',
    en: 'Glass of wine',
    macros: { kcal: 160, carb: 4, protein: 0, fat: 0, fiber: 0 },
  },
] as const;

export function quickNutrients(macros: {
  kcal: number;
  carb: number;
  protein: number;
  fat: number;
  fiber: number;
}): NutrientMap {
  return {
    'energy.energy': macros.kcal,
    'nutrient.carb': macros.carb,
    'nutrient.protein': macros.protein,
    'nutrient.fat': macros.fat,
    'nutrient.dietaryfiber': macros.fiber,
  };
}
