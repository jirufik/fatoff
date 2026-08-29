import { NUTRIENTS, nutrientIndexOf } from '@fatoff/contracts';

import { num, type Cell, type Table } from './table';
import type { NutrientMap } from '../yazio/yazio.types';

/**
 * Работа с нутриентами. Сам реестр живёт в `@fatoff/contracts` — по нему считает
 * выгрузка и по нему же рисуется справочник полей в интерфейсе.
 *
 * YAZIO отдаёт каждый нутриент в **граммах на одну базовую единицу** (энергию —
 * в килокалориях). Проверено на шпинате: `mineral.potassium` = 0.00554 на грамм
 * даёт 554 мг на 100 г, что совпадает со справочниками. Поэтому множитель ниже —
 * не пересчёт величины, а перевод в единицу, в которой нутриент принято
 * приводить.
 *
 * Ключа, о котором YAZIO ничего не знает, в ответе просто нет — он не приходит
 * нулём. У продукта, заведённого пользователем, семь ключей, у карточки из
 * базы — сорок. Поэтому «встретился хотя бы раз» — осмысленное правило отбора
 * колонок, и оно отличает неотслеживаемый нутриент от честного нуля (в
 * оливковом масле действительно нет углеводов).
 */

/** Реестр переэкспортируется, чтобы остальной код не знал, где он лежит. */
export { NUTRIENTS };
export type { NutrientKey } from '@fatoff/contracts';

export function indexOf(apiKey: string): number | undefined {
  return nutrientIndexOf(apiKey);
}

export function columnOf(apiKey: string): string | undefined {
  const index = indexOf(apiKey);
  return index === undefined ? undefined : NUTRIENTS[index].column;
}

/**
 * Нутриенты одной позиции: индекс в реестре → значение в граммах.
 * Разреженный набор — типичный продукт заполняет семь ключей из пятидесяти
 * четырёх, и хранить пятьдесят четыре нуля значило бы соврать про остальные.
 */
export class NutrientVec {
  private readonly values = new Map<number, number>();

  /** `scale` — количество съеденного: карточка продукта хранит значения на единицу. */
  static fromMap(map: NutrientMap | null | undefined, scale: number): NutrientVec {
    const vec = new NutrientVec();
    if (!map) return vec;

    for (const [key, raw] of Object.entries(map)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const index = indexOf(key);
      if (index === undefined) continue;
      vec.values.set(index, raw * scale);
    }
    return vec;
  }

  /** Ключи, которых нет в реестре. Они выпадают из выгрузки, поэтому о них сообщают. */
  static unknownKeys(map: NutrientMap | null | undefined): string[] {
    if (!map) return [];
    return Object.keys(map).filter((key) => indexOf(key) === undefined);
  }

  /** Прибавляет `other * scale`. Отсутствующий с одной стороны ключ считается нулём. */
  addScaled(other: NutrientVec, scale = 1): void {
    for (const [index, value] of other.values) {
      this.values.set(index, (this.values.get(index) ?? 0) + value * scale);
    }
  }

  get(index: number): number | undefined {
    return this.values.get(index);
  }

  /** Значение по ключу API, уже в единице колонки. */
  display(apiKey: string): number | undefined {
    const index = indexOf(apiKey);
    if (index === undefined) return undefined;
    const value = this.values.get(index);
    return value === undefined ? undefined : value * NUTRIENTS[index].factor;
  }

  indices(): number[] {
    return [...this.values.keys()].sort((a, b) => a - b);
  }

  get size(): number {
    return this.values.size;
  }

  clone(): NutrientVec {
    const copy = new NutrientVec();
    copy.addScaled(this, 1);
    return copy;
  }
}

/**
 * Таблица, чьи последние колонки — нутриенты, которые действительно встретились.
 *
 * Наблюдение идёт при добавлении строки, а расширение — при завершении, поэтому
 * набор колонок ровно тот, что наблюдался: нутриент не может получить колонку от
 * продукта, который выгрузили, но не съели.
 */
export class NutrientTableBuilder {
  private readonly observed = new Set<number>();
  private readonly skip = new Set<number>();
  private readonly rows: Array<{ base: Cell[]; nutrients: NutrientVec }> = [];

  constructor(
    private readonly name: string,
    private readonly baseColumns: readonly string[],
    /** Нутриенты, у которых уже есть своя колонка среди базовых. */
    skip: readonly string[] = [],
  ) {
    for (const key of skip) {
      const index = indexOf(key);
      if (index !== undefined) this.skip.add(index);
    }
  }

  push(base: Cell[], nutrients: NutrientVec): void {
    if (base.length !== this.baseColumns.length) {
      throw new Error(
        `Таблица ${this.name}: ожидалось ${this.baseColumns.length} базовых ячеек, получено ${base.length}`,
      );
    }
    for (const index of nutrients.indices()) {
      if (!this.skip.has(index)) this.observed.add(index);
    }
    this.rows.push({ base, nutrients });
  }

  get length(): number {
    return this.rows.length;
  }

  finish(): Table {
    const dynamic = [...this.observed].sort((a, b) => a - b);
    const columns = [...this.baseColumns, ...dynamic.map((index) => NUTRIENTS[index].column)];

    const rows = this.rows.map(({ base, nutrients }) => [
      ...base,
      ...dynamic.map((index) => {
        const value = nutrients.get(index);
        return value === undefined ? null : num(value * NUTRIENTS[index].factor);
      }),
    ]);

    return { name: this.name, columns, rows };
  }
}
