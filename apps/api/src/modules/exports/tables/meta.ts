import type { BuildWarning } from '../source';
import { TableBuilder, str, type Table } from '../table';

export interface MetaInfo {
  toolVersion: string;
  apiVersion: string;
  account: string | null;
  from: string;
  to: string;
  generatedAt: string;
  days: number;
  entries: number;
  products: number;
  recipes: number;
  warnings: number;
}

export function metaTable(info: MetaInfo): Table {
  const builder = new TableBuilder('meta', [
    'tool_version',
    'api_version',
    'account',
    'from',
    'to',
    'generated_at',
    'days_with_data',
    'entries',
    'products',
    'recipes',
    'warnings',
  ]);

  builder.push([
    info.toolVersion,
    info.apiVersion,
    str(info.account),
    info.from,
    info.to,
    info.generatedAt,
    info.days,
    info.entries,
    info.products,
    info.recipes,
    info.warnings,
  ]);

  return builder.finish();
}

/**
 * Опись выгрузки.
 *
 * Нужна потому, что пустая таблица в JSON кодируется как `[]`, а в TOON как
 * `name[0]:` — в обоих случаях список колонок теряется. Здесь он выживает.
 */
export function tablesIndexTable(tables: Table[]): Table {
  const builder = new TableBuilder('tables', ['name', 'rows', 'columns']);
  for (const table of tables) {
    builder.push([table.name, table.rows.length, table.columns.join(';')]);
  }
  return builder.finish();
}

export function warningsTable(warnings: BuildWarning[]): Table {
  const builder = new TableBuilder('warnings', ['phase', 'key', 'message']);
  for (const warning of warnings) {
    builder.push([warning.phase, str(warning.key), warning.message]);
  }
  return builder.finish();
}
