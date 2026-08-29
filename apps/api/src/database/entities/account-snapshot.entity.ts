import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

export type AccountSnapshotKind =
  | 'user'
  | 'settings'
  | 'dietary_preferences'
  | 'subscription'
  | 'streak'
  | 'fasting';

/**
 * Сырые ответы уровня аккаунта: по одной актуальной записи на вид.
 * Каждый стоит один запрос независимо от длины периода, поэтому они
 * перезаписываются целиком при каждой синхронизации.
 */
@Entity({ tableName: 'account_snapshot' })
@Unique({ properties: ['account', 'kind'] })
export class AccountSnapshot {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  kind!: AccountSnapshotKind;

  /** Ответ как есть. Массивы заворачиваются в `{ items: [...] }` — jsonb-колонка хранит объект. */
  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'timestamptz' })
  fetchedAt: Date = new Date();
}
