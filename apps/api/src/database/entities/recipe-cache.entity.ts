import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Карточка рецепта. Публичные рецепты и собственные лежат по разным путям API,
 * но имеют одну схему; какой это, запись дневника не сообщает, поэтому
 * принадлежность выясняется при выгрузке и сохраняется здесь.
 */
@Entity({ tableName: 'recipe_cache' })
@Unique({ properties: ['account', 'recipeId'] })
export class RecipeCache {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  recipeId!: string;

  /** Нутриенты внутри — на одну порцию. */
  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'boolean' })
  isUserRecipe: boolean = false;

  @Property({ type: 'timestamptz' })
  fetchedAt: Date = new Date();
}
