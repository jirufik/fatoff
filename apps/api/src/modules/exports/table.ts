/**
 * Маленькое реляционное представление, к которому сводится вся выгрузка.
 *
 * Таблица — это имя, упорядоченные колонки и строки строго скалярных ячеек.
 * Скалярность обязательна: она и позволяет TOON кодировать таблицу компактной
 * табличной формой, а CSV — существовать вообще.
 */

export type Cell = null | boolean | number | string;

export interface Table {
  name: string;
  columns: string[];
  rows: Cell[][];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function significant(value: number, digits: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  return round(value, digits - 1 - magnitude);
}

/**
 * Число для вывода: два знака после запятой.
 *
 * Но микронутриенты приходят в количествах, где два знака округлили бы живое
 * значение в ноль (селен меряют микрограммами), поэтому всё, что схлопнулось бы
 * в ноль, сохраняет четыре значащих цифры.
 */
export function num(value: number | null | undefined): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  let rounded = round(value, 2);
  if (rounded === 0 && value !== 0) rounded = significant(value, 4);
  // -0 в выводе — мусор, нормализуем
  return rounded === 0 ? 0 : rounded;
}

/** `null`, а не пустая строка: отсутствие значения и пустое значение — разные вещи. */
export function str(value: string | null | undefined): Cell {
  return value === null || value === undefined ? null : value;
}

/**
 * Список в одну ячейку. Вложенный массив выбросил бы таблицу из табличной формы
 * TOON, поэтому списки склеиваются.
 */
export function join(items: readonly string[] | null | undefined, separator = ';'): Cell {
  if (!items || items.length === 0) return null;
  return items.join(separator);
}

/** Значение произвольного JSON в скалярную ячейку. */
export function scalar(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return num(value);
  return JSON.stringify(value);
}

export class TableBuilder {
  private readonly rows: Cell[][] = [];

  constructor(
    private readonly name: string,
    private readonly columns: readonly string[],
  ) {}

  push(cells: Cell[]): void {
    if (cells.length !== this.columns.length) {
      throw new Error(
        `Таблица ${this.name}: ожидалось ${this.columns.length} ячеек, получено ${cells.length}`,
      );
    }
    this.rows.push(cells);
  }

  get length(): number {
    return this.rows.length;
  }

  finish(): Table {
    return { name: this.name, columns: [...this.columns], rows: this.rows };
  }
}

/** Ячейка CSV: `null` и пустая строка неразличимы, в JSON и TOON — различимы. */
export function toCsvField(cell: Cell): string {
  if (cell === null) return '';
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  return String(cell);
}
