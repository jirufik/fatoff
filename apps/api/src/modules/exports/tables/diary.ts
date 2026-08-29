import { dateRange } from '../../../common/date.util';
import { NutrientTableBuilder, NutrientVec } from '../nutrients';
import type { BuildWarning, ExportSource } from '../source';
import { num, str, type Cell, type Table } from '../table';

/**
 * Запись дневника после подстановки карточки продукта.
 *
 * Промежуточный вид, а не сразу строка таблицы: по нему считаются и дневные
 * итоги, и итоги по приёмам пищи.
 */
export interface DiaryEntry {
  date: string;
  loggedAt: string;
  meal: string;
  entryId: string | null;
  sourceId: string | null;
  name: string;
  producer: string;
  kind: 'product' | 'simple_product' | 'recipe_portion';
  amount: number | null;
  serving: string;
  servingQuantity: number | null;
  aiGenerated: boolean | null;
  /** Итог по этой записи: умножение на количество уже сделано. */
  nutrients: NutrientVec;
}

const COLUMNS = [
  'date',
  'logged_at',
  'meal',
  'entry_id',
  'source_id',
  'product',
  'producer',
  'type',
  'amount',
  'serving',
  'serving_quantity',
  'ai_generated',
] as const;

/**
 * Разворачивает дневник в записи с подставленными нутриентами.
 *
 * Три вида записей масштабируются по-разному, и это главное место, где выгрузка
 * может незаметно соврать: продукт хранит нутриенты на базовую единицу, рецепт —
 * на порцию, а быстрая запись не хранит базовой единицы вовсе.
 */
export function buildEntries(source: ExportSource, warnings: BuildWarning[]): DiaryEntry[] {
  const entries: DiaryEntry[] = [];
  const unknownNutrients = new Set<string>();

  for (const product of source.products.values()) {
    for (const key of NutrientVec.unknownKeys(product.nutrients)) unknownNutrients.add(key);
  }
  for (const { recipe } of source.recipes.values()) {
    for (const key of NutrientVec.unknownKeys(recipe.nutrients)) unknownNutrients.add(key);
  }

  for (const date of dateRange(source.from, source.to)) {
    const consumed = source.days.get(date)?.consumed;
    if (!consumed) continue;

    for (const item of consumed.products ?? []) {
      const product = source.products.get(item.product_id);
      entries.push({
        date,
        loggedAt: item.date,
        meal: item.daytime,
        entryId: item.id ?? null,
        sourceId: item.product_id,
        // запись остаётся, даже если карточка не выгрузилась: терять съеденное нельзя
        name: product?.name ?? `Unknown (${item.product_id})`,
        producer: product?.producer ?? '',
        kind: 'product',
        amount: item.amount,
        serving: item.serving ?? '',
        servingQuantity: item.serving_quantity ?? null,
        aiGenerated: null,
        nutrients: NutrientVec.fromMap(product?.nutrients, item.amount),
      });
    }

    for (const item of consumed.simple_products ?? []) {
      for (const key of NutrientVec.unknownKeys(item.nutrients)) unknownNutrients.add(key);
      entries.push({
        date,
        loggedAt: item.date,
        meal: item.daytime,
        entryId: item.id ?? null,
        sourceId: null,
        name: item.name ?? 'Quick added',
        producer: '',
        kind: 'simple_product',
        // нутриенты быстрой записи уже итоговые: количества не существует,
        // и написать здесь ноль значило бы его выдумать
        amount: null,
        serving: '',
        servingQuantity: null,
        aiGenerated: item.is_ai_generated ?? null,
        nutrients: NutrientVec.fromMap(item.nutrients, 1),
      });
    }

    for (const item of consumed.recipe_portions ?? []) {
      const found = source.recipes.get(item.recipe_id);
      const portions = item.portion_count ?? 0;
      entries.push({
        date,
        loggedAt: item.date,
        meal: item.daytime,
        entryId: item.id ?? null,
        sourceId: item.recipe_id,
        name: found?.recipe.name ?? `Recipe (${item.recipe_id})`,
        producer: '',
        kind: 'recipe_portion',
        amount: portions,
        serving: 'portion',
        servingQuantity: portions,
        aiGenerated: null,
        // карточка рецепта хранит значения на одну порцию
        nutrients: NutrientVec.fromMap(found?.recipe.nutrients, portions),
      });
    }
  }

  if (unknownNutrients.size > 0) {
    warnings.push({
      phase: 'Нутриенты',
      key: null,
      message: `Пропущены нутриенты, которых нет в реестре (${unknownNutrients.size}): ${[...unknownNutrients].sort().join(', ')}`,
    });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.loggedAt.localeCompare(b.loggedAt));
  return entries;
}

export function nutritionLogTable(entries: DiaryEntry[]): Table {
  const builder = new NutrientTableBuilder('nutrition_log', COLUMNS);
  for (const entry of entries) {
    builder.push(
      [
        entry.date,
        entry.loggedAt,
        entry.meal,
        str(entry.entryId),
        str(entry.sourceId),
        entry.name,
        entry.producer,
        entry.kind,
        num(entry.amount),
        entry.serving,
        num(entry.servingQuantity),
        entry.aiGenerated,
      ],
      entry.nutrients,
    );
  }
  return builder.finish();
}

/** Суммы нутриентов по ключу группировки плюс число записей. */
export function totalsBy(
  entries: DiaryEntry[],
  key: (entry: DiaryEntry) => string,
): Map<string, { count: number; nutrients: NutrientVec }> {
  const totals = new Map<string, { count: number; nutrients: NutrientVec }>();
  for (const entry of entries) {
    const group = key(entry);
    let slot = totals.get(group);
    if (!slot) {
      slot = { count: 0, nutrients: new NutrientVec() };
      totals.set(group, slot);
    }
    slot.count++;
    slot.nutrients.addScaled(entry.nutrients);
  }
  return totals;
}

/**
 * Строка на каждый день периода, а не только на дни с едой: день, где есть шаги
 * или вес, но нет записей, иначе исчез бы из выгрузки целиком.
 *
 * Макросы берутся у YAZIO как авторитетные, остальные нутриенты досчитываются.
 */
export function dailySummaryTable(source: ExportSource, entries: DiaryEntry[]): Table {
  const computed = totalsBy(entries, (entry) => entry.date);

  const builder = new NutrientTableBuilder(
    'daily_summary',
    [
      'date',
      'energy_kcal',
      'energy_goal_kcal',
      'carbs_g',
      'protein_g',
      'fat_g',
      'steps',
      'activity_energy_kcal',
      'water_ml',
    ],
    ['energy.energy', 'nutrient.carb', 'nutrient.protein', 'nutrient.fat'],
  );

  for (const date of dateRange(source.from, source.to)) {
    const totals = source.dailyNutrients.get(date);
    const day = source.days.get(date);
    // день не выгружали — пусто; выгрузили, а активности нет — ноль
    const activity = day?.exercises ? (day.exercises.activity ?? null) : undefined;
    const summary = source.dailyExercise.get(date);

    const steps = summary?.steps ?? (activity === undefined ? null : (activity?.steps ?? 0));
    const activeEnergy = summary?.energy ?? (activity === undefined ? null : (activity?.energy ?? 0));

    const base: Cell[] = [
      date,
      num(totals?.energy),
      num(totals?.energyGoal),
      num(totals?.carb),
      num(totals?.protein),
      num(totals?.fat),
      num(steps),
      num(activeEnergy),
      num(day?.water ? (day.water.water_intake ?? 0) : null),
    ];

    builder.push(base, computed.get(date)?.nutrients ?? new NutrientVec());
  }

  return builder.finish();
}

export function mealSummaryTable(entries: DiaryEntry[]): Table {
  const builder = new NutrientTableBuilder('meal_summary', ['date', 'meal', 'entry_count']);

  const totals = totalsBy(entries, (entry) => `${entry.date} ${entry.meal}`);
  for (const key of [...totals.keys()].sort()) {
    const [date, meal] = key.split(' ');
    const slot = totals.get(key)!;
    builder.push([date, meal, slot.count], slot.nutrients);
  }

  return builder.finish();
}
