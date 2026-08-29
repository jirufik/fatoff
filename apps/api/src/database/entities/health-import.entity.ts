import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import { Account } from './account.entity';

export type HealthImportStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * Один прогон загрузки выгрузки Apple Health.
 *
 * Он же носитель прогресса: файл известного размера читается потоком, и доля
 * прочитанных байт — честная мера продвижения. Фронт опрашивает строку так же,
 * как строку синхронизации YAZIO (D-008).
 */
@Entity({ tableName: 'health_import' })
export class HealthImport {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Account, { deleteRule: 'cascade' })
  account!: Account;

  /**
   * Имя файла, как его назвал источник.
   *
   * У загрузки из Google Drive путь внутренний (`<uuid>-drive.xml`), и
   * показывать его человеку бессмысленно — он видел файл под другим именем.
   */
  @Property({ type: 'text', nullable: true })
  fileLabel?: string | null;

  /** Путь к файлу внутри смонтированного каталога выгрузок. */
  @Property({ type: 'text' })
  filePath!: string;

  @Property({ type: 'bigint' })
  sizeBytes: number = 0;

  /** `ExportDate` из самого файла — когда Apple его собрал. */
  @Property({ type: 'string', length: 19, nullable: true })
  exportedAt: string | null = null;

  @Index()
  @Property({ type: 'text' })
  status: HealthImportStatus = 'queued';

  @Property({ type: 'text', nullable: true })
  phase: string | null = null;

  @Property({ type: 'bigint' })
  bytesRead: number = 0;

  @Property({ type: 'integer' })
  records: number = 0;

  @Property({ type: 'integer' })
  workouts: number = 0;

  @Property({ type: 'integer' })
  days: number = 0;

  /** Типы, встреченные в файле, и сколько их — для отчёта и для справочника. */
  @Property({ type: 'json' })
  typeCounts: Record<string, number> = {};

  @Property({ type: 'json' })
  warnings: string[] = [];

  @Property({ type: 'boolean' })
  cancelRequested: boolean = false;

  @Property({ type: 'text', nullable: true })
  error: string | null = null;

  @Property({ type: 'string', length: 10, nullable: true })
  dateFrom: string | null = null;

  @Property({ type: 'string', length: 10, nullable: true })
  dateTo: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  startedAt: Date | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null = null;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
