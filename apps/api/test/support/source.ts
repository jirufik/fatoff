import { DATASETS, type Dataset } from '@fatoff/contracts';

import type { DaySource, ExportSource } from '../../src/modules/exports/source';

/** Пустой день: все шесть эндпоинтов «не запрашивали». */
export const emptyDay = (over: Partial<DaySource> = {}): DaySource => ({
  consumed: null,
  exercises: null,
  water: null,
  goals: null,
  goalsUnmodified: null,
  feeling: null,
  ...over,
});

/**
 * Сырьё для тестов построителей.
 *
 * Собирается вручную, а не из фикстуры целиком: тест должен показывать ровно те
 * данные, поведение на которых проверяет.
 */
export function makeSource(over: Partial<ExportSource> = {}): ExportSource {
  return {
    from: '2026-08-01',
    to: '2026-08-03',
    datasets: new Set<Dataset>(DATASETS),
    redact: false,
    user: null,
    settings: null,
    dietaryPreferences: null,
    subscriptions: [],
    streak: {},
    fasting: [],
    dailyNutrients: new Map(),
    dailyExercise: new Map(),
    bodyValues: [],
    days: new Map(),
    products: new Map(),
    recipes: new Map(),
    health: null,
    ...over,
  };
}

/** Яблоко: значения на один грамм, как их отдаёт YAZIO. */
export const APPLE = {
  name: 'Яблоко',
  producer: null,
  category: 'fruits',
  base_unit: 'g',
  is_verified: true,
  is_private: false,
  is_deleted: false,
  has_ean: false,
  eans: [],
  countries: ['fi'],
  language: 'ru',
  updated_at: '2025-01-15 10:00:00',
  servings: [{ serving: 'piece', amount: 150 }],
  nutrients: {
    'energy.energy': 0.52,
    'nutrient.carb': 0.1381,
    'nutrient.protein': 0.0026,
    'mineral.potassium': 0.00107,
  },
};

/** Карточка на три ключа — так выглядит запись, заведённая руками. */
export const OIL = {
  name: 'Оливковое масло',
  producer: 'Своя запись',
  base_unit: 'ml',
  is_private: true,
  servings: [{ serving: 'tablespoon', amount: 13 }],
  nutrients: { 'energy.energy': 8.84, 'nutrient.fat': 1, 'nutrient.carb': 0 },
};

export const SOUP = {
  name: 'Овощной суп',
  locale: 'ru',
  portion_count: 4,
  is_yazio_recipe: true,
  is_pro_recipe: false,
  // на одну порцию, а не на весь рецепт
  nutrients: { 'energy.energy': 210, 'nutrient.protein': 9.2 },
  servings: [{ product_id: 'p-oil', name: 'Оливковое масло', amount: 13, base_unit: 'ml' }],
  instructions: ['Нарезать', 'Варить'],
};
