import type { ExportSource } from '../source';
import { TableBuilder, num, type Table } from '../table';

/**
 * Вес получает свою таблицу: его отслеживают почти все, а обхват груди —
 * единицы, и мешать их в одну кучу значит усложнить чтение самой нужной.
 */
export function weightTable(source: ExportSource): Table {
  const builder = new TableBuilder('weight', ['date', 'logged_at', 'weight_kg']);

  const values = source.bodyValues
    .filter((value) => value.kind === 'weight')
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

  for (const value of values) {
    builder.push([value.date, value.loggedAt, num(value.value)]);
  }

  return builder.finish();
}

export function bodyValuesTable(source: ExportSource): Table {
  const builder = new TableBuilder('body_values', ['date', 'logged_at', 'type', 'value']);

  const values = source.bodyValues
    .filter((value) => value.kind !== 'weight')
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.loggedAt.localeCompare(b.loggedAt));

  for (const value of values) {
    builder.push([value.date, value.loggedAt, value.kind, num(value.value)]);
  }

  return builder.finish();
}
