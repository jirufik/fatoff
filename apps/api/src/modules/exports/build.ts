import { reconcile } from './reconcile';
import type { BuildWarning, ExportSource } from './source';
import type { Table } from './table';
import {
  fastingTables,
  profileTable,
  settingsTable,
  subscriptionsTable,
} from './tables/account';
import { bodyValuesTable, weightTable } from './tables/body';
import { productTables, recipeTables } from './tables/catalogue';
import {
  buildEntries,
  dailySummaryTable,
  mealSummaryTable,
  nutritionLogTable,
  type DiaryEntry,
} from './tables/diary';
import { activityTables, dailyGoalsTable, feelingsTable, streakTable } from './tables/day';
import {
  combinedDailyTable,
  healthDailyTable,
  healthSleepTable,
  healthWorkoutsTable,
} from './tables/health';
import { metaTable, tablesIndexTable, warningsTable, type MetaInfo } from './tables/meta';

export interface BuildOptions {
  toolVersion: string;
  apiVersion: string;
  /** Метка аккаунта для таблицы `meta`; при обезличивании не подставляется. */
  account: string | null;
  generatedAt: string;
}

export interface BuildResult {
  tables: Table[];
  entries: DiaryEntry[];
  warnings: BuildWarning[];
  meta: MetaInfo;
}

/**
 * Сборка всех таблиц из сырья.
 *
 * Чистая функция: ни базы, ни сети, ни времени, кроме переданного. Отсюда и
 * требование к экспорту — два прогона на тех же данных дают одинаковый файл.
 */
export function buildTables(source: ExportSource, options: BuildOptions): BuildResult {
  const warnings: BuildWarning[] = [];
  const wants = (dataset: string): boolean => source.datasets.has(dataset as never);

  const entries = buildEntries(source, warnings);
  reconcile(source, entries, warnings);
  noteGaps(source, warnings);

  const tables: Table[] = [];

  if (wants('diary')) {
    tables.push(nutritionLogTable(entries), dailySummaryTable(source, entries), mealSummaryTable(entries));
  }
  if (wants('goals')) tables.push(dailyGoalsTable(source));
  if (wants('activity')) {
    const { daily, workouts } = activityTables(source);
    tables.push(daily, workouts);
  }
  if (wants('weight')) tables.push(weightTable(source));
  if (wants('body-values')) tables.push(bodyValuesTable(source));
  if (wants('feelings')) tables.push(feelingsTable(source));
  if (wants('streak')) tables.push(streakTable(source));
  if (wants('products')) {
    const { products, servings } = productTables(source);
    tables.push(products, servings);
  }
  if (wants('recipes')) {
    const { recipes, ingredients, instructions } = recipeTables(source);
    tables.push(recipes, ingredients, instructions);
  }
  if (wants('account')) {
    tables.push(profileTable(source), settingsTable(source), subscriptionsTable(source));
  }
  if (wants('fasting')) {
    const { history, periods, patches } = fastingTables(source);
    tables.push(history, periods, patches);
  }

  // Apple Health и сведение с YAZIO — только если выгрузка загружена
  if (source.health) {
    tables.push(
      healthDailyTable(source),
      healthWorkoutsTable(source),
      healthSleepTable(source),
      combinedDailyTable(source, entries),
    );
  }

  const meta: MetaInfo = {
    toolVersion: options.toolVersion,
    apiVersion: options.apiVersion,
    account: source.redact ? null : options.account,
    from: source.from,
    to: source.to,
    generatedAt: options.generatedAt,
    days: countDaysWithData(source),
    entries: entries.length,
    products: source.products.size,
    recipes: source.recipes.size,
    warnings: warnings.length,
  };

  // опись строится до того, как к таблицам добавятся meta и warnings, но встаёт
  // перед данными: читающий встречает схему раньше строк
  const index = tablesIndexTable(tables);
  return {
    tables: [metaTable(meta), index, ...tables, warningsTable(warnings)],
    entries,
    warnings,
    meta,
  };
}

function countDaysWithData(source: ExportSource): number {
  let days = 0;
  for (const [date, day] of source.days) {
    if (date < source.from || date > source.to) continue;
    if (day.consumed || day.exercises || day.water || day.goals || day.feeling) days++;
  }
  return days;
}

/**
 * День, о котором YAZIO сообщил итоги, но подробностей в базе нет — это дыра в
 * выгрузке, а не пустой день. Молчать о ней нельзя: анализ по такому файлу
 * решит, что человек в этот день ничего не ел.
 */
function noteGaps(source: ExportSource, warnings: BuildWarning[]): void {
  const gaps: string[] = [];

  for (const [date] of [...source.dailyNutrients.entries()].sort()) {
    if (date < source.from || date > source.to) continue;
    if (!source.days.get(date)?.consumed) gaps.push(date);
  }

  if (gaps.length === 0) return;
  warnings.push({
    phase: 'Полнота',
    key: null,
    message:
      `дней с итогами, но без выгруженного дневника: ${gaps.length} ` +
      `(${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? ', …' : ''}). Запустите синхронизацию.`,
  });
}
