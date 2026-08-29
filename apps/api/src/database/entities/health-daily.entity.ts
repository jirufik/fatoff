import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Дневной итог по одному типу и одному источнику.
 *
 * Разбивка по источнику обязательна: часы и телефон считают шаги независимо, и
 * сложить их — получить в полтора раза больше, чем было. Кто победил на этот
 * день, решается при чтении, а обе серии остаются видны.
 *
 * Хранятся сразу все сводные величины: у накопительных типов осмысленна сумма,
 * у мгновенных — среднее, и таблица не должна знать, какой тип к какому классу
 * относится.
 */
@Entity({ tableName: 'health_daily' })
@Unique({ properties: ['account', 'date', 'type', 'source'] })
export class HealthDaily {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  /** Тип без приставки `HKQuantityTypeIdentifier`: `StepCount`, `HeartRate`. */
  @Index()
  @Property({ type: 'text' })
  type!: string;

  @Property({ type: 'text' })
  source!: string;

  @Property({ type: 'text', nullable: true })
  unit: string | null = null;

  @Property({ type: 'integer' })
  samples: number = 0;

  @Property({ type: 'double' })
  sum: number = 0;

  @Property({ type: 'double', nullable: true })
  min: number | null = null;

  @Property({ type: 'double', nullable: true })
  max: number | null = null;

  @Property({ type: 'double', nullable: true })
  avg: number | null = null;
}
