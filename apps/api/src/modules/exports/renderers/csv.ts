import { toCsvField, type Table } from '../table';

/**
 * CSV по RFC 4180: кавычки только там, где без них нельзя, внутренняя кавычка
 * удваивается.
 *
 * Здесь теряется разница между отсутствующим значением и пустой строкой — в
 * CSV её выразить нечем. В JSON и TOON она сохраняется.
 */
function escape(field: string): string {
  if (!/[",\n\r]/.test(field) && field.trim() === field) return field;
  return `"${field.replaceAll('"', '""')}"`;
}

export function renderCsv(table: Table): string {
  const lines = [table.columns.map(escape).join(',')];
  for (const row of table.rows) {
    lines.push(row.map((cell) => escape(toCsvField(cell))).join(','));
  }
  return `${lines.join('\n')}\n`;
}
