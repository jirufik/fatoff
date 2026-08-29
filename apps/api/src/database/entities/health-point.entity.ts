import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/**
 * Отдельный замер там, где важен каждый, а их мало: масса тела, доля жира, ИМТ,
 * рост, обхват талии, VO2Max. Свёртка по дню такие величины обесценивает —
 * взвешиваний за восемь лет полторы сотни, и каждое имеет значение.
 */
@Entity({ tableName: 'health_point' })
@Unique({ properties: ['account', 'type', 'measuredAt', 'source'] })
export class HealthPoint {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Index()
  @Property({ type: 'text' })
  type!: string;

  @Property({ type: 'string', length: 19 })
  measuredAt!: string;

  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  @Property({ type: 'double' })
  value: number = 0;

  @Property({ type: 'text', nullable: true })
  unit: string | null = null;

  @Property({ type: 'text', nullable: true })
  source: string | null = null;
}
