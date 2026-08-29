import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Дневные итоги, посчитанные самим YAZIO.
 *
 * Двойная роль: их показывает дашборд, и по ним же работает инкрементальность
 * (D-012). Один запрос `nutrients-daily` возвращает их за весь период, и
 * сравнение с этой таблицей даёт точный список дней, которые надо перекачать.
 */
@Entity({ tableName: 'daily_nutrients' })
@Unique({ properties: ['account', 'date'] })
export class DailyNutrients {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  /** Килокалории независимо от того, что выбрано в настройках профиля. */
  @Property({ type: 'double' })
  energy: number = 0;

  @Property({ type: 'double' })
  carb: number = 0;

  @Property({ type: 'double' })
  protein: number = 0;

  @Property({ type: 'double' })
  fat: number = 0;

  @Property({ type: 'double' })
  energyGoal: number = 0;

  @Property({ type: 'timestamptz' })
  fetchedAt: Date = new Date();
}
