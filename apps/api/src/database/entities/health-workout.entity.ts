import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

/** Одна тренировка: вид, длительность и то, что часы про неё насчитали. */
@Entity({ tableName: 'health_workout' })
@Unique({ properties: ['account', 'startedAt', 'type'] })
export class HealthWorkout {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Index()
  @Property({ type: 'string', length: 10 })
  date!: string;

  @Property({ type: 'string', length: 19 })
  startedAt!: string;

  @Property({ type: 'string', length: 19, nullable: true })
  endedAt: string | null = null;

  /** Вид без приставки `HKWorkoutActivityType`: `Walking`, `Running`. */
  @Property({ type: 'text' })
  type!: string;

  @Property({ type: 'double' })
  durationMin: number = 0;

  @Property({ type: 'double', nullable: true })
  energyKcal: number | null = null;

  @Property({ type: 'double', nullable: true })
  distanceKm: number | null = null;

  @Property({ type: 'text', nullable: true })
  source: string | null = null;
}
