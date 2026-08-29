import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

export const BODY_VALUE_KINDS = [
  'weight',
  'body_fat',
  'muscle_ratio',
  'waist',
  'hip',
  'chest',
] as const;

export type BodyValueKind = (typeof BODY_VALUE_KINDS)[number];

/**
 * Замеры тела. Ключ — вид и полная отметка времени: за день бывает несколько
 * взвешиваний, и схлопывать их в дату значило бы терять записи.
 */
@Entity({ tableName: 'body_value' })
@Unique({ properties: ['account', 'kind', 'loggedAt'] })
export class BodyValue {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  kind!: BodyValueKind;

  /** `YYYY-MM-DD HH:MM:SS`, как отдаёт YAZIO. */
  @Property({ type: 'string', length: 19 })
  loggedAt!: string;

  /** Дата из отметки — по ней запись соединяется с остальными таблицами. */
  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  @Property({ type: 'double' })
  value: number = 0;
}
