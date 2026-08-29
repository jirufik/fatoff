import type { FakeAccountData, FakeDay } from '../fake-yazio';
import type {
  NutrientMap,
  YazioConsumedProduct,
  YazioProduct,
  YazioRecipe,
} from '../../src/modules/yazio/yazio.types';

/**
 * Синтетический аккаунт на десять дней.
 *
 * Собран так, чтобы в нём встретилось всё, на чём выгрузка может споткнуться:
 * разорванный приём пищи, быстрая запись без базовой единицы, рецепт, продукт
 * с тремя нутриентами против продукта с тридцатью, пропущенные дни, день с
 * расхождением итогов и запись на продукт, которого больше нет.
 */

/** Нутриенты YAZIO — на одну базовую единицу (грамм), а не на сто. */
const APPLE: NutrientMap = {
  'energy.energy': 0.52,
  'nutrient.carb': 0.1381,
  'nutrient.protein': 0.0026,
  'nutrient.fat': 0.0017,
  'nutrient.dietaryfiber': 0.024,
  'nutrient.sugar': 0.1039,
  'mineral.potassium': 0.00107,
  'vitamin.c': 0.0000046,
};

/** Всего три ключа: так выглядит карточка, заведённая пользователем вручную. */
const OIL: NutrientMap = {
  'energy.energy': 8.84,
  'nutrient.fat': 1,
  'nutrient.saturated': 0.1554,
};

const BREAD: NutrientMap = {
  'energy.energy': 2.65,
  'nutrient.carb': 0.491,
  'nutrient.protein': 0.09,
  'nutrient.fat': 0.032,
  'nutrient.dietaryfiber': 0.027,
  'nutrient.salt': 0.0119,
  'nutrient.sodium': 0.00471,
  'mineral.calcium': 0.00151,
  'mineral.iron': 0.0000362,
};

/** Рецепт: значения на одну порцию, а не на весь объём. */
const SOUP_PER_PORTION: NutrientMap = {
  'energy.energy': 210,
  'nutrient.carb': 18.4,
  'nutrient.protein': 9.2,
  'nutrient.fat': 11.1,
  'nutrient.dietaryfiber': 3.2,
};

const PRODUCTS: Record<string, YazioProduct> = {
  'p-apple': {
    name: 'Яблоко',
    producer: null,
    category: 'fruits',
    base_unit: 'g',
    is_verified: true,
    is_private: false,
    is_deleted: false,
    has_ean: false,
    eans: [],
    countries: ['de', 'fi'],
    language: 'ru',
    updated_at: '2025-01-15 10:00:00',
    servings: [
      { serving: 'piece', amount: 150 },
      { serving: 'gram', amount: 1 },
    ],
    nutrients: APPLE,
  },
  'p-oil': {
    name: 'Оливковое масло',
    producer: 'Своя запись',
    category: 'oils',
    base_unit: 'ml',
    is_verified: false,
    is_private: true,
    is_deleted: false,
    has_ean: false,
    eans: [],
    countries: [],
    language: 'ru',
    updated_at: '2026-02-02 08:00:00',
    servings: [{ serving: 'tablespoon', amount: 13 }],
    nutrients: OIL,
  },
  'p-bread': {
    name: 'Белый хлеб',
    producer: 'Пекарня',
    category: 'bread',
    base_unit: 'g',
    is_verified: true,
    is_private: false,
    is_deleted: false,
    has_ean: true,
    eans: ['4001234567890'],
    countries: ['de'],
    language: 'ru',
    updated_at: '2024-11-01 12:00:00',
    servings: [{ serving: 'slice', amount: 30 }],
    nutrients: BREAD,
  },
};

const RECIPES: Record<string, YazioRecipe> = {
  'r-soup': {
    name: 'Овощной суп',
    locale: 'ru',
    portion_count: 4,
    is_yazio_recipe: true,
    is_pro_recipe: false,
    nutrients: SOUP_PER_PORTION,
    servings: [
      { product_id: 'p-bread', name: 'Белый хлеб', amount: 60, base_unit: 'g', serving: 'slice', serving_quantity: 2 },
      { product_id: 'p-oil', name: 'Оливковое масло', amount: 13, base_unit: 'ml', serving: 'tablespoon', serving_quantity: 1 },
    ],
    instructions: ['Нарезать овощи', 'Варить 20 минут'],
  },
};

const USER_RECIPES: Record<string, YazioRecipe> = {
  'ur-omelette': {
    name: 'Омлет как дома',
    locale: 'ru',
    portion_count: 1,
    is_yazio_recipe: false,
    is_pro_recipe: false,
    nutrients: { 'energy.energy': 330, 'nutrient.protein': 21, 'nutrient.fat': 26, 'nutrient.carb': 2 },
    servings: [],
    instructions: [],
  },
};

const entry = (
  id: string,
  productId: string,
  date: string,
  time: string,
  daytime: string,
  amount: number,
  serving = 'gram',
  servingQuantity = amount,
): YazioConsumedProduct => ({
  id,
  product_id: productId,
  date: `${date} ${time}`,
  daytime,
  amount,
  serving,
  serving_quantity: servingQuantity,
  type: 'product',
});

const days: Record<string, FakeDay> = {
  '2026-08-01': {
    consumed: {
      products: [
        entry('e1', 'p-apple', '2026-08-01', '08:12:00', 'breakfast', 150, 'piece', 1),
        entry('e2', 'p-bread', '2026-08-01', '13:30:00', 'lunch', 90),
      ],
      recipe_portions: [],
      simple_products: [],
    },
    goals: { 'energy.energy': 1900, 'nutrient.carb': 230, 'nutrient.protein': 95, 'nutrient.fat': 60, 'activity.step': 10000, water: 2000 },
    water: { water_intake: 1500 },
  },
  // разорванный обед: две записи в один приём пищи — законная ситуация
  '2026-08-02': {
    consumed: {
      products: [
        entry('e3', 'p-bread', '2026-08-02', '12:40:00', 'lunch', 60),
        entry('e4', 'p-oil', '2026-08-02', '12:41:00', 'lunch', 13, 'tablespoon', 1),
      ],
      recipe_portions: [],
      simple_products: [
        {
          id: 'e5',
          date: '2026-08-02 19:00:00',
          daytime: 'dinner',
          name: 'Ужин в гостях',
          is_ai_generated: true,
          // у быстрой записи нутриенты уже итоговые, умножать не на что
          nutrients: { 'energy.energy': 640, 'nutrient.carb': 55, 'nutrient.protein': 30, 'nutrient.fat': 32 },
        },
      ],
    },
    goals: { 'energy.energy': 1900, 'nutrient.carb': 230, 'nutrient.protein': 95, 'nutrient.fat': 60 },
    feeling: { note: 'Тяжёлый день', tags: ['tired', 'stressed'] },
  },
  '2026-08-03': {
    consumed: {
      products: [],
      recipe_portions: [
        { id: 'e6', recipe_id: 'r-soup', date: '2026-08-03 13:00:00', daytime: 'lunch', portion_count: 2 },
        { id: 'e7', recipe_id: 'ur-omelette', date: '2026-08-03 08:00:00', daytime: 'breakfast', portion_count: 1 },
      ],
      simple_products: [],
    },
    water: { water_intake: 2100 },
  },
  // 2026-08-04 и 2026-08-07 — дни без записей, их нет и в итогах
  '2026-08-05': {
    consumed: {
      products: [entry('e8', 'p-apple', '2026-08-05', '09:00:00', 'breakfast', 200)],
      recipe_portions: [],
      simple_products: [],
    },
    goals: { 'energy.energy': 1850, 'nutrient.carb': 220, 'nutrient.protein': 100, 'nutrient.fat': 58 },
    goalsUnmodified: { 'energy.energy': 1900, 'nutrient.carb': 230, 'nutrient.protein': 95, 'nutrient.fat': 60 },
    water: { water_intake: 900 },
    feeling: { note: null, tags: ['happy'] },
  },
  // запись на продукт, которого в базе YAZIO больше нет
  '2026-08-06': {
    consumed: {
      products: [entry('e9', 'p-vanished', '2026-08-06', '14:00:00', 'lunch', 120)],
      recipe_portions: [],
      simple_products: [],
    },
  },
  // день, где итоги YAZIO не сходятся с суммой записей — проверка сверки
  '2026-08-08': {
    consumed: {
      products: [entry('e10', 'p-bread', '2026-08-08', '12:00:00', 'lunch', 100)],
      recipe_portions: [],
      simple_products: [],
    },
  },
  '2026-08-09': {
    consumed: {
      products: [
        entry('e11', 'p-apple', '2026-08-09', '08:00:00', 'breakfast', 150, 'piece', 1),
        entry('e12', 'p-bread', '2026-08-09', '19:00:00', 'dinner', 120),
      ],
      recipe_portions: [],
      simple_products: [],
    },
    exercises: {
      activity: { energy: 320, steps: 8400, distance: 6100, duration: 74, source: 'health_kit', gateway: 'apple' },
      training: [
        { id: 't1', name: 'Бег', note: 'вечером', energy: 410, duration: 35, distance: 5200, steps: 5400, gateway: 'manual', source: 'user' },
      ],
      custom_training: [],
    },
  },
  '2026-08-10': {
    consumed: {
      products: [entry('e13', 'p-apple', '2026-08-10', '08:30:00', 'breakfast', 100)],
      recipe_portions: [],
      simple_products: [],
    },
  },
};

/** Сумма нутриента по всем записям дня — итоги фикстуры считаются, а не выдумываются. */
function dailyTotal(day: FakeDay, key: string): number {
  let total = 0;
  for (const item of day.consumed?.products ?? []) {
    const nutrients = PRODUCTS[item.product_id]?.nutrients;
    total += (nutrients?.[key] ?? 0) * item.amount;
  }
  for (const item of day.consumed?.recipe_portions ?? []) {
    const nutrients = (RECIPES[item.recipe_id] ?? USER_RECIPES[item.recipe_id])?.nutrients;
    total += (nutrients?.[key] ?? 0) * (item.portion_count ?? 0);
  }
  for (const item of day.consumed?.simple_products ?? []) {
    total += item.nutrients?.[key] ?? 0;
  }
  return total;
}

export function buildSyntheticAccount(): FakeAccountData {
  const dailyNutrients = Object.entries(days)
    .filter(([, day]) => (day.consumed?.products?.length ?? 0) + (day.consumed?.recipe_portions?.length ?? 0) + (day.consumed?.simple_products?.length ?? 0) > 0)
    .map(([date, day]) => ({
      date,
      energy: dailyTotal(day, 'energy.energy'),
      carb: dailyTotal(day, 'nutrient.carb'),
      protein: dailyTotal(day, 'nutrient.protein'),
      fat: dailyTotal(day, 'nutrient.fat'),
      energy_goal: 1900,
    }));

  // продукта p-vanished нет в каталоге — сумма за 06.08 останется нулевой,
  // и YAZIO об этом не знает: он считал её, когда карточка ещё была
  const vanished = dailyNutrients.find((d) => d.date === '2026-08-06');
  if (vanished) Object.assign(vanished, { energy: 480, carb: 60, protein: 12, fat: 20 });

  // а здесь итоги разошлись без всякой причины — так выглядит правка карточки
  // продукта задним числом, и сверка обязана это заметить
  const drifted = dailyNutrients.find((d) => d.date === '2026-08-08');
  if (drifted) drifted.energy += 300;

  return {
    email: 'user@example.com',
    password: 'секрет',
    user: {
      registration_date: '2026-08-01 07:00:00',
      uuid: '00000000-0000-0000-0000-000000000001',
      email: 'user@example.com',
      first_name: 'Тест',
      last_name: 'Тестов',
      sex: 'male',
      date_of_birth: '1984-01-12',
      body_height: 182,
      start_weight: 75,
      weight_change_per_week: -0.5,
      goal: 'lose',
      pal: 1.38,
      city: 'Хельсинки',
      country: 'FI',
      language: 'ru',
      locale: 'ru',
      timezone_offset: 180,
      unit_mass: 'kg',
      unit_energy: 'kj',
      unit_length: 'cm',
      unit_serving: 'oz',
      unit_glucose: 'mmoll',
      is_premium: false,
      login_type: 'email_password',
      email_confirmation_status: 'pending',
      newsletter_opt_in: false,
      last_active_date: '2026-08-10',
      diet: { name: 'default', carb_percentage: 50, fat_percentage: 30, protein_percentage: 20 },
      tags: [],
    },
    settings: { has_water_tracker: true, has_feelings: true, consume_activity_calories: true },
    dietaryPreferences: { restriction: null },
    subscriptions: [],
    streak: {
      '2026-08-01': { daytimes: ['breakfast', 'lunch'], origin_of_recovery: null },
      '2026-08-02': { daytimes: ['lunch', 'dinner'], origin_of_recovery: null },
      '2026-08-03': { daytimes: ['breakfast', 'lunch'], origin_of_recovery: null },
    },
    fasting: [],
    dailyNutrients,
    exerciseSummary: [
      { date: '2026-08-09', steps: 8400, duration: 74, energy: 320 },
      { date: '2026-08-10', steps: 3100, duration: 22, energy: 90 },
    ],
    bodyValues: {
      weight: [
        { date: '2026-08-01 07:05:00', value: 75 },
        { date: '2026-08-05 07:10:00', value: 74.4 },
        { date: '2026-08-10 07:02:00', value: 73.8 },
      ],
      body_fat: [{ date: '2026-08-01 07:05:00', value: 22.5 }],
      muscle_ratio: [],
      waist: [],
      hip: [],
      chest: [],
    },
    days,
    products: PRODUCTS,
    recipes: RECIPES,
    userRecipes: USER_RECIPES,
  };
}

export { PRODUCTS as SYNTHETIC_PRODUCTS, RECIPES as SYNTHETIC_RECIPES, USER_RECIPES as SYNTHETIC_USER_RECIPES };
