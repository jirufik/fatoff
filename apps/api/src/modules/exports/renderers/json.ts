import type { Cell, Table } from '../table';

/** Строка таблицы как объект: порядок ключей — порядок колонок. */
function toObject(table: Table, row: Cell[]): Record<string, Cell> {
  const object: Record<string, Cell> = {};
  table.columns.forEach((column, index) => {
    object[column] = row[index] ?? null;
  });
  return object;
}

export function tableToJson(table: Table): Array<Record<string, Cell>> {
  return table.rows.map((row) => toObject(table, row));
}

/** Все таблицы одним документом: `{ имя_таблицы: [ строки ] }`. */
export function renderJson(tables: Table[]): string {
  const bundle: Record<string, Array<Record<string, Cell>>> = {};
  for (const table of tables) bundle[table.name] = tableToJson(table);
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
