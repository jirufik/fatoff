import { NutrientTableBuilder, NutrientVec } from '../nutrients';
import type { ExportSource } from '../source';
import { TableBuilder, join, num, str, type Table } from '../table';

/**
 * Карточки продуктов и их порции.
 *
 * Нутриенты здесь остаются такими, как их отдаёт YAZIO — **на одну базовую
 * единицу**, грамм или миллилитр, а не на сто. Оливковое масло читается как
 * 8.22 ккал. Это единственное место выгрузки, где нужна такая осторожность:
 * в `nutrition_log` умножение уже сделано.
 */
export function productTables(source: ExportSource): { products: Table; servings: Table } {
  const products = new NutrientTableBuilder('products', [
    'product_id',
    'name',
    'producer',
    'category',
    'base_unit',
    'is_verified',
    'is_private',
    'is_deleted',
    'has_ean',
    'eans',
    'language',
    'countries',
    'updated_at',
  ]);

  const servings = new TableBuilder('product_servings', ['product_id', 'serving', 'amount']);

  // порядок фиксируется, иначе повторная сборка даёт другой файл
  for (const id of [...source.products.keys()].sort()) {
    const product = source.products.get(id)!;

    products.push(
      [
        id,
        str(product.name),
        str(product.producer),
        str(product.category),
        str(product.base_unit),
        product.is_verified ?? false,
        product.is_private ?? false,
        product.is_deleted ?? false,
        product.has_ean ?? false,
        join(product.eans),
        str(product.language),
        join(product.countries),
        str(product.updated_at),
      ],
      NutrientVec.fromMap(product.nutrients, 1),
    );

    for (const serving of product.servings ?? []) {
      servings.push([id, str(serving.serving), num(serving.amount)]);
    }
  }

  return { products: products.finish(), servings: servings.finish() };
}

/** Рецепты: нутриенты — на одну порцию, как их и отдаёт API. */
export function recipeTables(source: ExportSource): {
  recipes: Table;
  ingredients: Table;
  instructions: Table;
} {
  const recipes = new NutrientTableBuilder('recipes', [
    'recipe_id',
    'name',
    'locale',
    'portion_count',
    'is_yazio_recipe',
    'is_pro_recipe',
    'is_user_recipe',
    'ingredient_count',
  ]);

  const ingredients = new TableBuilder('recipe_ingredients', [
    'recipe_id',
    'position',
    'product_id',
    'name',
    'producer',
    'amount',
    'base_unit',
    'serving',
    'serving_quantity',
    'note',
  ]);

  const instructions = new TableBuilder('recipe_instructions', ['recipe_id', 'step', 'text']);

  for (const id of [...source.recipes.keys()].sort()) {
    const { recipe, isUserRecipe } = source.recipes.get(id)!;

    recipes.push(
      [
        id,
        str(recipe.name),
        str(recipe.locale),
        num(recipe.portion_count),
        recipe.is_yazio_recipe ?? false,
        recipe.is_pro_recipe ?? false,
        isUserRecipe,
        (recipe.servings ?? []).length,
      ],
      NutrientVec.fromMap(recipe.nutrients, 1),
    );

    (recipe.servings ?? []).forEach((serving, index) => {
      ingredients.push([
        id,
        index + 1,
        str(serving.product_id),
        str(serving.name),
        str(serving.producer),
        num(serving.amount),
        str(serving.base_unit),
        str(serving.serving),
        num(serving.serving_quantity),
        str(serving.note),
      ]);
    });

    (recipe.instructions ?? []).forEach((step, index) => {
      instructions.push([id, index + 1, typeof step === 'string' ? step : JSON.stringify(step)]);
    });
  }

  return {
    recipes: recipes.finish(),
    ingredients: ingredients.finish(),
    instructions: instructions.finish(),
  };
}
