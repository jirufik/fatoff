import type { Text } from './common.js';

/**
 * Реестр нутриентов YAZIO: что как называется, в чём измеряется и во что
 * переводится.
 *
 * Лежит в общем пакете намеренно. По нему считает выгрузка и по нему же
 * рисуется справочник полей в интерфейсе — если держать два списка, они
 * разойдутся, и справочник начнёт врать.
 *
 * YAZIO отдаёт каждый нутриент в **граммах на одну базовую единицу** продукта
 * (энергию — в килокалориях). `factor` переводит это в единицу, в которой
 * нутриент принято приводить: граммы, миллиграммы или микрограммы.
 */

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'ug';
export type NutrientGroup = 'energy' | 'macros' | 'fats' | 'other' | 'vitamins' | 'minerals';

const MG = 1_000;
const UG = 1_000_000;

export interface NutrientKey {
  /** Ключ в ответе YAZIO. */
  apiKey: string;
  /** Имя колонки в выгрузке. */
  column: string;
  /** Множитель из граммов в единицу колонки. */
  factor: number;
  /** Человеческое название для справочника — на обоих языках. */
  title: Text;
  /** Единица колонки; человеческая подпись собирается интерфейсом. */
  unit: NutrientUnit;
  group: NutrientGroup;
}

const key = (
  apiKey: string,
  column: string,
  factor: number,
  ru: string,
  en: string,
  unit: NutrientUnit,
  group: NutrientGroup,
): NutrientKey => ({ apiKey, column, factor, title: { ru, en }, unit, group });

/** Порядок здесь — это порядок колонок в выгрузке. */
export const NUTRIENTS: readonly NutrientKey[] = [
  key('energy.energy', 'energy_kcal', 1, 'Энергия', 'Energy', 'kcal', 'energy'),

  key('nutrient.carb', 'carbs_g', 1, 'Углеводы', 'Carbs', 'g', 'macros'),
  key('nutrient.protein', 'protein_g', 1, 'Белки', 'Protein', 'g', 'macros'),
  key('nutrient.fat', 'fat_g', 1, 'Жиры', 'Fat', 'g', 'macros'),

  key('nutrient.saturated', 'saturated_fat_g', 1, 'Насыщенные жиры', 'Saturated fat', 'g', 'fats'),
  key('nutrient.monounsaturated', 'monounsaturated_fat_g', 1, 'Мононенасыщенные жиры', 'Monounsaturated fat', 'g', 'fats'),
  key('nutrient.polyunsaturated', 'polyunsaturated_fat_g', 1, 'Полиненасыщенные жиры', 'Polyunsaturated fat', 'g', 'fats'),
  key('nutrient.transfat', 'trans_fat_g', 1, 'Трансжиры', 'Trans fat', 'g', 'fats'),
  key('nutrient.cholesterol', 'cholesterol_mg', MG, 'Холестерин', 'Cholesterol', 'mg', 'fats'),

  key('nutrient.dietaryfiber', 'fiber_g', 1, 'Клетчатка', 'Fibre', 'g', 'other'),
  key('nutrient.sugar', 'sugar_g', 1, 'Сахара', 'Sugars', 'g', 'other'),
  key('nutrient.addedsugar', 'added_sugar_g', 1, 'Добавленный сахар', 'Added sugar', 'g', 'other'),
  key('nutrient.salt', 'salt_g', 1, 'Соль', 'Salt', 'g', 'other'),
  key('nutrient.sodium', 'sodium_mg', MG, 'Натрий', 'Sodium', 'mg', 'other'),
  key('nutrient.water', 'water_g', 1, 'Вода в продукте', 'Water in the product', 'g', 'other'),
  key('nutrient.alcohol', 'alcohol_g', 1, 'Алкоголь', 'Alcohol', 'g', 'other'),

  key('vitamin.a', 'vitamin_a_ug', UG, 'Витамин A', 'Vitamin A', 'ug', 'vitamins'),
  key('vitamin.b1', 'vitamin_b1_mg', MG, 'Витамин B1, тиамин', 'Vitamin B1, thiamine', 'mg', 'vitamins'),
  key('vitamin.b2', 'vitamin_b2_mg', MG, 'Витамин B2, рибофлавин', 'Vitamin B2, riboflavin', 'mg', 'vitamins'),
  key('vitamin.b3', 'vitamin_b3_mg', MG, 'Витамин B3, ниацин', 'Vitamin B3, niacin', 'mg', 'vitamins'),
  key('vitamin.b5', 'vitamin_b5_mg', MG, 'Витамин B5, пантотеновая кислота', 'Vitamin B5, pantothenic acid', 'mg', 'vitamins'),
  key('vitamin.b6', 'vitamin_b6_mg', MG, 'Витамин B6', 'Vitamin B6', 'mg', 'vitamins'),
  key('vitamin.b7', 'vitamin_b7_ug', UG, 'Витамин B7, биотин', 'Vitamin B7, biotin', 'ug', 'vitamins'),
  key('vitamin.b11', 'folate_ug', UG, 'Фолаты, витамин B9', 'Folate, vitamin B9', 'ug', 'vitamins'),
  key('vitamin.b12', 'vitamin_b12_ug', UG, 'Витамин B12', 'Vitamin B12', 'ug', 'vitamins'),
  key('vitamin.c', 'vitamin_c_mg', MG, 'Витамин C', 'Vitamin C', 'mg', 'vitamins'),
  key('vitamin.d', 'vitamin_d_ug', UG, 'Витамин D', 'Vitamin D', 'ug', 'vitamins'),
  key('vitamin.e', 'vitamin_e_mg', MG, 'Витамин E', 'Vitamin E', 'mg', 'vitamins'),
  key('vitamin.k', 'vitamin_k_ug', UG, 'Витамин K', 'Vitamin K', 'ug', 'vitamins'),

  key('mineral.calcium', 'calcium_mg', MG, 'Кальций', 'Calcium', 'mg', 'minerals'),
  key('mineral.iron', 'iron_mg', MG, 'Железо', 'Iron', 'mg', 'minerals'),
  key('mineral.magnesium', 'magnesium_mg', MG, 'Магний', 'Magnesium', 'mg', 'minerals'),
  key('mineral.phosphorus', 'phosphorus_mg', MG, 'Фосфор', 'Phosphorus', 'mg', 'minerals'),
  key('mineral.potassium', 'potassium_mg', MG, 'Калий', 'Potassium', 'mg', 'minerals'),
  key('mineral.zinc', 'zinc_mg', MG, 'Цинк', 'Zinc', 'mg', 'minerals'),
  key('mineral.copper', 'copper_mg', MG, 'Медь', 'Copper', 'mg', 'minerals'),
  key('mineral.manganese', 'manganese_mg', MG, 'Марганец', 'Manganese', 'mg', 'minerals'),
  key('mineral.selenium', 'selenium_ug', UG, 'Селен', 'Selenium', 'ug', 'minerals'),
  key('mineral.iodine', 'iodine_ug', UG, 'Йод', 'Iodine', 'ug', 'minerals'),
  key('mineral.chlorine', 'chlorine_mg', MG, 'Хлор', 'Chlorine', 'mg', 'minerals'),
  key('mineral.sulfur', 'sulfur_mg', MG, 'Сера', 'Sulphur', 'mg', 'minerals'),
  key('mineral.fluoride', 'fluoride_mg', MG, 'Фторид', 'Fluoride', 'mg', 'minerals'),
  key('mineral.fluorine', 'fluorine_mg', MG, 'Фтор', 'Fluorine', 'mg', 'minerals'),
  key('mineral.biotin', 'biotin_ug', UG, 'Биотин', 'Biotin', 'ug', 'minerals'),
  key('mineral.choline', 'choline_mg', MG, 'Холин', 'Choline', 'mg', 'minerals'),
  key('mineral.chrome', 'chromium_mg', MG, 'Хром', 'Chromium', 'mg', 'minerals'),
  key('mineral.cobalt', 'cobalt_ug', UG, 'Кобальт', 'Cobalt', 'ug', 'minerals'),
  key('mineral.molybdenum', 'molybdenum_ug', UG, 'Молибден', 'Molybdenum', 'ug', 'minerals'),
  key('mineral.boron', 'boron_mg', MG, 'Бор', 'Boron', 'mg', 'minerals'),
  key('mineral.silicon', 'silicon_mg', MG, 'Кремний', 'Silicon', 'mg', 'minerals'),
  key('mineral.arsenic', 'arsenic_ug', UG, 'Мышьяк', 'Arsenic', 'ug', 'minerals'),
  key('mineral.rubidium', 'rubidium_ug', UG, 'Рубидий', 'Rubidium', 'ug', 'minerals'),
  key('mineral.tin', 'tin_mg', MG, 'Олово', 'Tin', 'mg', 'minerals'),
  key('mineral.vanadium', 'vanadium_ug', UG, 'Ванадий', 'Vanadium', 'ug', 'minerals'),
];

const BY_API_KEY = new Map(NUTRIENTS.map((nutrient, index) => [nutrient.apiKey, index]));
const BY_COLUMN = new Map(NUTRIENTS.map((nutrient) => [nutrient.column, nutrient]));

export function nutrientIndexOf(apiKey: string): number | undefined {
  return BY_API_KEY.get(apiKey);
}

export function nutrientByColumn(column: string): NutrientKey | undefined {
  return BY_COLUMN.get(column);
}
