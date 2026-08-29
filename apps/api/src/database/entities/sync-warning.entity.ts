import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { WarningKind } from '@fatoff/contracts';

import { SyncRun } from './sync-run.entity';

/**
 * Сбой одного запроса или странность в данных.
 *
 * Существует ради того, чтобы «что-то не выгрузилось» было видно, а не
 * оборачивалось молча пустым днём и успешным завершением.
 */
@Entity({ tableName: 'sync_warning' })
export class SyncWarning {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => SyncRun, { deleteRule: 'cascade' })
  run!: SyncRun;

  @Property({ type: 'text' })
  phase!: string;

  @Property({ type: 'text' })
  endpoint!: string;

  /** Дата или идентификатор, к которому относился запрос. */
  @Property({ type: 'text', nullable: true })
  key: string | null = null;

  @Property({ type: 'text' })
  kind: WarningKind = 'http';

  @Property({ type: 'integer', nullable: true })
  status: number | null = null;

  @Property({ type: 'text' })
  message!: string;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
