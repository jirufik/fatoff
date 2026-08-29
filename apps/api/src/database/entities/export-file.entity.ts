import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { Dataset, ExportFormat, Granularity, TableStatDto } from '@fatoff/contracts';

import { Account } from './account.entity';

/** Собранный файл выгрузки: параметры сборки, путь на диске и что внутри. */
@Entity({ tableName: 'export_file' })
export class ExportFile {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  @Property({ type: 'string', length: 10 })
  dateFrom!: string;

  @Property({ type: 'string', length: 10 })
  dateTo!: string;

  @Property({ type: 'json' })
  datasets: Dataset[] = [];

  @Property({ type: 'json' })
  formats: ExportFormat[] = [];

  @Property({ type: 'text' })
  granularity: Granularity = 'auto';

  @Property({ type: 'boolean' })
  redact: boolean = false;

  @Property({ type: 'boolean' })
  includeHealth: boolean = true;

  @Property({ type: 'text' })
  status: 'running' | 'done' | 'failed' = 'running';

  @Property({ type: 'text', nullable: true })
  fileName: string | null = null;

  /** Путь относительно EXPORT_DIR — переезд каталога не ломает историю. */
  @Property({ type: 'text', nullable: true })
  filePath: string | null = null;

  @Property({ type: 'bigint', nullable: true })
  sizeBytes: number | null = null;

  @Property({ type: 'json' })
  tables: TableStatDto[] = [];

  @Property({ type: 'text', nullable: true })
  error: string | null = null;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null = null;
}
