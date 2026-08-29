import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Карточка продукта. Кэш на аккаунт, а не общий (D-007): приватные продукты
 * пользователя видны только ему, и общий кэш означал бы их утечку между
 * аккаунтами.
 */
@Entity({ tableName: 'product_cache' })
@Unique({ properties: ['account', 'productId'] })
export class ProductCache {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  productId!: string;

  /** Нутриенты внутри — на одну базовую единицу, не на 100 грамм. */
  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'text', nullable: true })
  name: string | null = null;

  @Property({ type: 'timestamptz' })
  fetchedAt: Date = new Date();
}
