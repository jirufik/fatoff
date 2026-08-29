import { describe, expect, it } from 'vitest';

import { NUTRIENTS, NutrientTableBuilder, NutrientVec, columnOf, indexOf } from './nutrients';

describe('реестр нутриентов', () => {
  it('содержит все 54 ключа и не повторяет колонки', () => {
    expect(NUTRIENTS).toHaveLength(54);
    expect(new Set(NUTRIENTS.map((n) => n.column)).size).toBe(54);
    expect(new Set(NUTRIENTS.map((n) => n.apiKey)).size).toBe(54);
  });

  it('начинается с энергии и макросов — это порядок колонок', () => {
    expect(NUTRIENTS.slice(0, 4).map((n) => n.column)).toEqual([
      'energy_kcal',
      'carbs_g',
      'protein_g',
      'fat_g',
    ]);
  });

  it('знает единицу, в которой нутриент принято приводить', () => {
    expect(columnOf('nutrient.sodium')).toBe('sodium_mg');
    expect(columnOf('vitamin.b11')).toBe('folate_ug');
    expect(indexOf('такого.нет')).toBeUndefined();
  });
});

describe('набор нутриентов позиции', () => {
  // яблоко: значения на один грамм, как их отдаёт YAZIO
  const apple = { 'energy.energy': 0.52, 'nutrient.carb': 0.1381, 'mineral.potassium': 0.00107 };

  it('масштабирует на съеденное количество', () => {
    const vec = NutrientVec.fromMap(apple, 150);
    expect(vec.display('energy.energy')).toBeCloseTo(78, 6);
    expect(vec.display('nutrient.carb')).toBeCloseTo(20.715, 6);
  });

  it('переводит минералы в миллиграммы', () => {
    // 0.00107 г/г × 150 г = 0.1605 г = 160.5 мг
    expect(NutrientVec.fromMap(apple, 150).display('mineral.potassium')).toBeCloseTo(160.5, 6);
  });

  it('отсутствующий ключ остаётся отсутствующим, а не нулём', () => {
    const vec = NutrientVec.fromMap(apple, 100);
    expect(vec.display('nutrient.fat')).toBeUndefined();
    expect(vec.size).toBe(3);
  });

  it('сохраняет честный ноль', () => {
    const oil = { 'energy.energy': 8.84, 'nutrient.carb': 0 };
    expect(NutrientVec.fromMap(oil, 10).display('nutrient.carb')).toBe(0);
  });

  it('пропускает ключи, которых нет в реестре, и сообщает о них', () => {
    const map = { 'energy.energy': 1, 'nutrient.неведомый': 5 };
    expect(NutrientVec.fromMap(map, 1).size).toBe(1);
    expect(NutrientVec.unknownKeys(map)).toEqual(['nutrient.неведомый']);
  });

  it('пропускает нечисловые и бесконечные значения', () => {
    const map = { 'energy.energy': Number.NaN, 'nutrient.carb': Number.POSITIVE_INFINITY, 'nutrient.fat': 3 };
    expect(NutrientVec.fromMap(map, 1).size).toBe(1);
  });

  it('складывает разреженные наборы', () => {
    const total = NutrientVec.fromMap({ 'energy.energy': 100 }, 1);
    total.addScaled(NutrientVec.fromMap({ 'energy.energy': 50, 'nutrient.fat': 7 }, 1));
    expect(total.display('energy.energy')).toBe(150);
    expect(total.display('nutrient.fat')).toBe(7);
  });

  it('клон не тянет за собой изменения оригинала', () => {
    const original = NutrientVec.fromMap({ 'energy.energy': 100 }, 1);
    const copy = original.clone();
    original.addScaled(NutrientVec.fromMap({ 'energy.energy': 100 }, 1));
    expect(copy.display('energy.energy')).toBe(100);
  });
});

describe('таблица с колонками нутриентов', () => {
  it('выводит только те нутриенты, что встретились в данных', () => {
    const builder = new NutrientTableBuilder('t', ['date']);
    builder.push(['2026-08-01'], NutrientVec.fromMap({ 'energy.energy': 100 }, 1));
    builder.push(['2026-08-02'], NutrientVec.fromMap({ 'energy.energy': 200, 'nutrient.fat': 5 }, 1));

    const table = builder.finish();
    expect(table.columns).toEqual(['date', 'energy_kcal', 'fat_g']);
    // у первого дня жира не было — там пусто, а не ноль
    expect(table.rows[0]).toEqual(['2026-08-01', 100, null]);
    expect(table.rows[1]).toEqual(['2026-08-02', 200, 5]);
  });

  it('держит канонический порядок колонок независимо от порядка появления', () => {
    const builder = new NutrientTableBuilder('t', ['date']);
    builder.push(['д1'], NutrientVec.fromMap({ 'mineral.zinc': 0.01, 'energy.energy': 10 }, 1));
    expect(builder.finish().columns).toEqual(['date', 'energy_kcal', 'zinc_mg']);
  });

  it('не дублирует нутриент, у которого уже есть базовая колонка', () => {
    const builder = new NutrientTableBuilder('t', ['date', 'energy_kcal'], ['energy.energy']);
    builder.push(['д1', 100], NutrientVec.fromMap({ 'energy.energy': 100, 'nutrient.fat': 5 }, 1));
    expect(builder.finish().columns).toEqual(['date', 'energy_kcal', 'fat_g']);
  });

  it('ругается на строку неправильной ширины', () => {
    const builder = new NutrientTableBuilder('t', ['date', 'meal']);
    expect(() => builder.push(['д1'], new NutrientVec())).toThrow(/базовых ячеек/);
  });
});
