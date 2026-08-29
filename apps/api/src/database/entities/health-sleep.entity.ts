import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Одна ночь.
 *
 * Отрезок сна относится к дате пробуждения: сон с 23:41 до 07:12 попадает на то
 * утро, когда человек проснулся, — так об этом и думают. Иначе одна ночь
 * разъезжается на две даты.
 */
@Entity({ tableName: 'health_sleep' })
@Unique({ properties: ['account', 'night', 'source'] })
export class HealthSleep {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  /** Дата пробуждения. */
  @Index()
  @Property({ type: 'string', length: 10 })
  night!: string;

  @Property({ type: 'text' })
  source!: string;

  @Property({ type: 'double' })
  inBedMin: number = 0;

  /** Всего сна — сумма всех стадий, кроме «в постели» и «бодрствование». */
  @Property({ type: 'double' })
  asleepMin: number = 0;

  @Property({ type: 'double' })
  deepMin: number = 0;

  @Property({ type: 'double' })
  remMin: number = 0;

  @Property({ type: 'double' })
  coreMin: number = 0;

  @Property({ type: 'double' })
  awakeMin: number = 0;

  /** Когда легли и когда встали — по краям отрезков этой ночи. */
  @Property({ type: 'string', length: 19, nullable: true })
  fellAsleepAt: string | null = null;

  @Property({ type: 'string', length: 19, nullable: true })
  wokeAt: string | null = null;
}
