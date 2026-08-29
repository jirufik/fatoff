import type { Cell, Table } from '../table';

/**
 * TOON — табличная форма для языковых моделей.
 *
 * Смысл ровно один: имена колонок пишутся один раз в заголовке, а не на каждой
 * строке, как в JSON. На четырёхлетней истории это разница в разы по токенам, а
 * содержимое то же самое.
 *
 *     nutrition_log[380]{date,meal,product,energy_kcal}:
 *       2026-08-01,lunch,Хлеб,307.44
 *
 * Реализовано по спецификации toon-format/spec: отступ два пробела, разделитель
 * — запятая, пустой массив пишется как `name: []`.
 */

const DELIMITER = ',';
const INDENT = '  ';

/** Числа канонической десятичной записью; -0 нормализуется в 0. */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'null';
  if (Object.is(value, -0)) return '0';
  return String(value);
}

const NUMERIC_LIKE = /^[+-]?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

/** Кавычки ставятся тогда, когда без них строку прочтут неправильно. */
function needsQuotes(value: string): boolean {
  if (value === '') return true;
  if (value.trim() !== value) return true;
  if (value === 'true' || value === 'false' || value === 'null') return true;
  if (NUMERIC_LIKE.test(value)) return true;
  if (value.includes(':') || value.includes('"') || value.includes('\\')) return true;
  if (/[[\]{}]/.test(value)) return true;
  if (CONTROL.test(value)) return true;
  if (value.includes(DELIMITER)) return true;
  return value === '-' || value.startsWith('#') || value.startsWith('-');
}

function escapeString(value: string): string {
  let out = '';
  for (const char of value) {
    switch (char) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        out +=
          char < ' ' ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char;
    }
  }
  return out;
}

export function formatCell(cell: Cell): string {
  if (cell === null) return 'null';
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'number') return formatNumber(cell);
  return needsQuotes(cell) ? `"${escapeString(cell)}"` : cell;
}

export function renderToonTable(table: Table): string {
  if (table.rows.length === 0) return `${table.name}: []`;

  const header = `${table.name}[${table.rows.length}]{${table.columns.join(DELIMITER)}}:`;
  const rows = table.rows.map((row) => INDENT + row.map(formatCell).join(DELIMITER));
  return [header, ...rows].join('\n');
}

/** Все таблицы одним документом. */
export function renderToon(tables: Table[]): string {
  return `${tables.map(renderToonTable).join('\n')}\n`;
}
