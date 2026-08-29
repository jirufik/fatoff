import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { Dataset, SyncMode, SyncStatus } from '@fatoff/contracts';

import { Account } from './account.entity';

/**
 * Один запуск синхронизации.
 *
 * Он же носитель прогресса: строка обновляется по ходу работы, а фронт
 * опрашивает её раз в секунду (D-008). Отдельного состояния для докачки нет —
 * план строится заново из разницы «что в базе» и «что говорит YAZIO», поэтому
 * повторный запуск после обрыва продолжает с того же места по построению.
 */
@Entity({ tableName: 'sync_run' })
export class SyncRun {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'text' })
  mode: SyncMode = 'incremental';

  @Index()
  @Property({ type: 'text' })
  status: SyncStatus = 'queued';

  /** Человеческое имя текущего этапа: «Дневник», «Продукты», «Аккаунт». */
  @Property({ type: 'text', nullable: true })
  phase: string | null = null;

  @Property({ type: 'string', length: 10 })
  dateFrom!: string;

  @Property({ type: 'string', length: 10 })
  dateTo!: string;

  @Property({ type: 'json' })
  datasets: Dataset[] = [];

  @Property({ type: 'boolean' })
  allDays: boolean = false;

  @Property({ type: 'boolean' })
  force: boolean = false;

  @Property({ type: 'integer' })
  daysTotal: number = 0;

  @Property({ type: 'integer' })
  daysDone: number = 0;

  @Property({ type: 'integer' })
  requests: number = 0;

  @Property({ type: 'integer' })
  warningsCount: number = 0;

  /** Проверяется между днями: отмена не рвёт запрос на полуслове. */
  @Property({ type: 'boolean' })
  cancelRequested: boolean = false;

  @Property({ type: 'text', nullable: true })
  error: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  startedAt: Date | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null = null;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
