import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/** Дневная активность из `exercises/summary-daily` — один запрос на весь период. */
@Entity({ tableName: 'daily_exercise' })
@Unique({ properties: ['account', 'date'] })
export class DailyExercise {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  @Property({ type: 'double' })
  steps: number = 0;

  /** Минуты. */
  @Property({ type: 'double' })
  duration: number = 0;

  /** Активные килокалории. */
  @Property({ type: 'double' })
  energy: number = 0;

  @Property({ type: 'timestamptz' })
  fetchedAt: Date = new Date();
}
