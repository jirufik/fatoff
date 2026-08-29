import type { Dataset, IsoDate } from './common.js';

export type SyncMode = 'full' | 'incremental' | 'range';
export type SyncStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type WarningKind = 'http' | 'decode' | 'transport' | 'data';

export interface StartSyncRequest {
  mode?: SyncMode;
  from?: IsoDate;
  to?: IsoDate;
  datasets?: Dataset[];
  /** Пройти каждую дату периода, а не только дни, о которых YAZIO сообщил данные. */
  allDays?: boolean;
  /** Перекачать дни периода, даже если итоги не изменились. */
  force?: boolean;
}

export interface SyncWarningDto {
  phase: string;
  endpoint: string;
  key: string | null;
  kind: WarningKind;
  status: number | null;
  message: string;
}

export interface SyncRunDto {
  id: string;
  accountId: string;
  mode: SyncMode;
  status: SyncStatus;
  phase: string | null;
  from: IsoDate;
  to: IsoDate;
  datasets: Dataset[];
  daysTotal: number;
  daysDone: number;
  requests: number;
  warningsCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface SyncRunDetailDto extends SyncRunDto {
  warnings: SyncWarningDto[];
}
