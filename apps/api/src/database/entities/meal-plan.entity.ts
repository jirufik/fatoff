import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { GeneratedPlanDto } from '@fatoff/contracts';

import { Account } from './account.entity';

/**
 * Сохранённый план на период.
 *
 * План хранится собранным, а не пересчитывается при открытии: пул продуктов
 * меняется по мере синхронизации, и сохранённое на прошлой неделе должно
 * остаться тем, что человек видел, когда сохранял.
 */
@Entity({ tableName: 'meal_plan' })
export class MealPlan {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  name!: string;

  /** Свободные метки для поиска: их придумывает человек, справочника нет. */
  @Property({ type: 'json' })
  tags: string[] = [];

  @Property({ type: 'string', length: 10 })
  dateFrom!: string;

  @Property({ type: 'string', length: 10 })
  dateTo!: string;

  /** Весь план целиком: дни, меню, тренировки, нормы и настройки, при которых он вышел. */
  @Property({ type: 'json' })
  plan!: GeneratedPlanDto;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
