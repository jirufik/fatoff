import type { Message } from './common.js';

/**
 * Загрузка выгрузки Apple Health из папки Google Drive.
 *
 * Устройство описано в `docs/DRIVE-IMPORT.md`. Здесь — только то, чем
 * обмениваются сервер и интерфейс.
 */

export type DriveFetchStatus = 'same' | 'imported' | 'empty' | 'rejected' | 'failed';

export type DriveTrigger = 'schedule' | 'manual';

export interface DriveSettingsDto {
  /** Ссылка на папку или на сам файл; пусто — источник не задан. */
  url: string | null;
  /** Время ежедневной проверки, `ЧЧ:ММ`. */
  dailyAt: string | null;
  enabled: boolean;
  /**
   * Настроен ли ключ API на сервере.
   *
   * Без ключа Drive не отвечает даже на открытую папку, и интерфейс должен
   * сказать об этом до того, как человек нажмёт «Загрузить».
   */
  keyConfigured: boolean;
}

export interface DriveFetchDto {
  id: string;
  status: DriveFetchStatus;
  trigger: DriveTrigger;
  fileName: string | null;
  sizeBytes: number | null;
  bytesDownloaded: number;
  /** Загрузка Apple Health, если дошло до неё. */
  importId: string | null;
  /** Почему ничего не вышло — кодом, а не готовой фразой (D-044). */
  error: Message | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DriveSettingsInput {
  url?: string | null;
  dailyAt?: string | null;
  enabled?: boolean;
}
