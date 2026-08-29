import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Сырые ответы YAZIO по одному дню (D-003).
 *
 * Шесть полей — по одному на дневной эндпоинт. `null` значит «не запрашивали»,
 * пустой объект — «запросили, там пусто». Разница важна: 404 на воде означает,
 * что воду в этот день не пили, а не что выгрузка сломалась.
 */
@Entity({ tableName: 'day_snapshot' })
@Unique({ properties: ['account', 'date'] })
export class DaySnapshot {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  /** `YYYY-MM-DD` */
  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  /** `GET /user/consumed-items?date=` — дневник */
  @Property({ type: 'json', nullable: true })
  consumed: Record<string, unknown> | null = null;

  /** `GET /user/exercises?date=` */
  @Property({ type: 'json', nullable: true })
  exercises: Record<string, unknown> | null = null;

  /** `GET /user/water-intake?date=` */
  @Property({ type: 'json', nullable: true })
  water: Record<string, unknown> | null = null;

  /** `GET /user/goals?date=` */
  @Property({ type: 'json', nullable: true })
  goals: Record<string, unknown> | null = null;

  /** `GET /user/goals/unmodified?date=` */
  @Property({ type: 'json', nullable: true })
  goalsUnmodified: Record<string, unknown> | null = null;

  /** `GET /user/feeling?date=` */
  @Property({ type: 'json', nullable: true })
  feeling: Record<string, unknown> | null = null;

  @Property({ type: 'timestamptz' })
  fetchedAt: Date = new Date();
}
