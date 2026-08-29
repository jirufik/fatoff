import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { GenerateRequest } from '@fatoff/contracts';

import { Account } from './account.entity';

/**
 * Свой шаблон настроек генератора.
 *
 * Встроенные шаблоны живут в коде (`planner/templates.ts`): они часть поставки,
 * их не редактируют, и миграция под них не нужна. Здесь — только то, что человек
 * сохранил сам.
 */
@Entity({ tableName: 'plan_template' })
export class PlanTemplate {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  name!: string;

  @Property({ type: 'text' })
  description: string = '';

  /** Настройки без периода: шаблон говорит «как», а не «когда». */
  @Property({ type: 'json' })
  settings!: Partial<GenerateRequest>;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
