import type { Dataset, ExportFormat, IsoDate } from './common.js';

/** Как сворачивать дневной ряд в Markdown-дайджесте. */
export type Granularity = 'auto' | 'day' | 'week' | 'month';

export interface CreateExportRequest {
  from?: IsoDate;
  to?: IsoDate;
  datasets?: Dataset[];
  formats: ExportFormat[];
  granularity?: Granularity;
  /** Обезличить профиль: email, uuid, имя, дату рождения, город. */
  redact?: boolean;
  /**
   * Включать данные Apple Health и сведённую таблицу по дням. По умолчанию да —
   * если они для аккаунта загружены.
   */
  includeHealth?: boolean;
}

export interface TableStatDto {
  name: string;
  rows: number;
  columns: number;
}

export interface ExportFileDto {
  id: string;
  accountId: string;
  accountLabel: string;
  from: IsoDate;
  to: IsoDate;
  formats: ExportFormat[];
  datasets: Dataset[];
  redact: boolean;
  includeHealth: boolean;
  fileName: string;
  sizeBytes: number;
  tables: TableStatDto[];
  status: 'running' | 'done' | 'failed';
  error: string | null;
  createdAt: string;
}
