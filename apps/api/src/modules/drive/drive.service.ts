import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { message, type DriveFetchDto, type DriveSettingsDto } from '@fatoff/contracts';

import { AppConfigService } from '../../config/app-config.service';
import { Account, DriveFetch } from '../../database/entities';
import { AppleHealthService } from '../apple-health/apple-health.service';

import { NotAnExport, recognizeExport } from './drive-archive';
import { resolveDriveAuth } from './drive-auth';
import { DriveClient, DriveError, FOLDER_MIME, type DriveFile } from './drive-client';
import { DriveFailure } from './drive-failure';
import { parseDriveLink } from './drive-link';

/**
 * Что делать с тем, что лежит в папке Drive.
 *
 * Модуль ничего не знает о разборе XML: его дело — довести файл до диска и
 * позвать существующую загрузку Apple Health. Обратное тоже верно: загрузка
 * ничего не знает о Drive и по-прежнему работает с файлом в каталоге.
 */
@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly cfg: AppConfigService,
    private readonly health: AppleHealthService,
  ) {}

  /** Куда складывать скачанное. Каталог пользователя смонтирован на чтение. */
  private get cacheDir(): string {
    return resolve(process.cwd(), this.cfg.get('EXPORT_DIR'), '..', 'health');
  }

  /** Чем открывать папку: сервисный аккаунт предпочтительнее ключа. */
  private auth(): ReturnType<typeof resolveDriveAuth> {
    const file = this.cfg.get('GOOGLE_SERVICE_ACCOUNT_FILE').trim();
    return resolveDriveAuth(
      file ? resolve(process.cwd(), file) : '',
      this.cfg.get('GOOGLE_API_KEY'),
    );
  }

  private async client(): Promise<DriveClient | null> {
    const auth = await this.auth();
    return auth ? new DriveClient(auth, this.cfg.get('DRIVE_API_BASE')) : null;
  }

  async settings(accountId: string): Promise<DriveSettingsDto> {
    const account = await this.account(accountId);
    const auth = await this.auth();
    return {
      url: account.driveUrl,
      dailyAt: account.driveDailyAt,
      enabled: account.driveEnabled,
      keyConfigured: auth !== null,
      access: auth?.kind ?? null,
    };
  }

  async saveSettings(
    accountId: string,
    input: { url?: string | null; dailyAt?: string | null; enabled?: boolean },
  ): Promise<DriveSettingsDto> {
    const account = await this.account(accountId);

    if (input.url !== undefined) {
      const url = input.url?.trim() || null;
      // ссылку проверяем сразу: узнать о том, что она не та, через сутки на
      // расписании — худший из возможных моментов
      if (url && !parseDriveLink(url)) {
        throw new Error('Не похоже на ссылку Google Drive: нужна ссылка на папку или на файл');
      }
      account.driveUrl = url;
    }

    if (input.dailyAt !== undefined) {
      const at = input.dailyAt?.trim() || null;
      if (at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
        throw new Error('Время проверки задаётся как ЧЧ:ММ, например 06:30');
      }
      account.driveDailyAt = at;
    }

    if (input.enabled !== undefined) account.driveEnabled = input.enabled;

    await this.em.flush();
    return this.settings(accountId);
  }

  async history(accountId: string, limit = 20): Promise<DriveFetchDto[]> {
    const rows = await this.em.find(
      DriveFetch,
      { account: accountId },
      { orderBy: { startedAt: 'desc' }, limit },
    );
    return rows.map((row) => toDto(row));
  }

  /**
   * Сходить в папку и, если файл новый, запустить загрузку.
   *
   * Возвращает запись журнала — в том числе когда ничего делать не пришлось.
   * «Проверили, файл тот же» — самый частый исход, и он должен быть виден.
   */
  async check(accountId: string, trigger: 'schedule' | 'manual'): Promise<DriveFetchDto> {
    const em = this.em.fork();
    const account = await em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const record = em.create(DriveFetch, {
      account,
      status: 'failed',
      trigger,
      bytesDownloaded: 0,
      startedAt: new Date(),
    });
    await em.persistAndFlush(record);

    try {
      await this.run(em, account, record);
    } catch (error) {
      const failure = classify(error);
      record.status = failure.status;
      record.errorCode = failure.code;
      record.error = failure.text ?? null;
      this.logger.warn(`Проверка Drive для ${accountId}: ${failure.code} ${failure.text ?? ''}`);
    } finally {
      record.finishedAt = new Date();
      await em.flush();
    }

    return toDto(record);
  }

  private async run(em: EntityManager, account: Account, record: DriveFetch): Promise<void> {
    const client = await this.client();
    if (!client) throw new DriveFailure('drive.no-key');

    const link = account.driveUrl && parseDriveLink(account.driveUrl);
    if (!link) throw new DriveFailure('drive.no-url');

    const file = await this.pick(client, link);
    if (!file) {
      record.status = 'empty';
      return;
    }

    record.fileId = file.id;
    record.fileName = file.name;
    record.sizeBytes = file.sizeBytes;
    record.md5 = file.md5;
    await em.flush();

    if (await this.alreadyImported(em, account.id, file)) {
      record.status = 'same';
      return;
    }

    await mkdir(this.cacheDir, { recursive: true });
    const downloaded = join(this.cacheDir, `${account.id}-drive.bin`);
    const xml = join(this.cacheDir, `${account.id}-drive.xml`);

    let sinceFlush = 0;
    record.bytesDownloaded = await client.download(file.id, downloaded, (bytes) => {
      // строка обновляется не на каждый пакет: запись в базу дороже загрузки
      if (bytes - sinceFlush < 8 * 1024 * 1024) return;
      sinceFlush = bytes;
      record.bytesDownloaded = bytes;
      void em.flush();
    });
    await em.flush();

    try {
      const recognized = await recognizeExport(downloaded, xml);
      const started = await this.health.startAbsolute(account.id, recognized.xmlPath, file.name);
      record.importId = started.id;
      record.status = 'imported';
    } finally {
      // архив больше не нужен: разбирается уже распакованный XML
      if (downloaded !== xml) await rm(downloaded, { force: true });
    }
  }

  /** Какой файл в папке брать: свежий и похожий на выгрузку по имени. */
  private async pick(
    client: DriveClient,
    link: { kind: 'folder' | 'file'; id: string },
  ): Promise<DriveFile | null> {
    if (link.kind === 'file') {
      const file = await client.meta(link.id);
      return file.mimeType === FOLDER_MIME ? this.newest(await client.list(file.id)) : file;
    }

    const listed = await client.list(link.id);
    return this.newest(listed);
  }

  /**
   * Свежий подходящий файл.
   *
   * По имени отбирается лишь грубо — архивы и XML: в папке рядом с выгрузкой
   * лежат заметки и снимки экрана, и качать их по двести мегабайт, чтобы потом
   * отклонить, незачем. Настоящая проверка всё равно по содержимому.
   */
  private newest(files: DriveFile[]): DriveFile | null {
    const candidates = files
      .filter((file) => file.mimeType !== FOLDER_MIME)
      .filter((file) => /\.(zip|xml)$/i.test(file.name));

    if (candidates.length === 0) return null;

    return candidates.sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))[0];
  }

  /** Был ли этот же файл уже загружен: сверяется контрольная сумма. */
  private async alreadyImported(
    em: EntityManager,
    accountId: string,
    file: DriveFile,
  ): Promise<boolean> {
    if (!file.md5) return false; // без суммы честнее перекачать, чем угадывать

    const previous = await em.findOne(DriveFetch, {
      account: accountId,
      status: 'imported',
      md5: file.md5,
    });
    return previous !== null;
  }

  private async account(accountId: string): Promise<Account> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);
    return account;
  }
}

/**
 * Что за беда случилась — кодом.
 *
 * Отдельная функция, потому что источников три: свой отказ, ответ Drive и
 * неопознанное. Первые два перечислимы, третий — нет, и его текст едет
 * подстановкой в единственное сообщение-заглушку.
 */
function classify(error: unknown): {
  status: 'rejected' | 'failed';
  code: string;
  text?: string;
} {
  if (error instanceof NotAnExport) return { status: 'rejected', code: error.code };
  if (error instanceof DriveFailure) return { status: 'failed', code: error.code };
  if (error instanceof DriveError) {
    return { status: 'failed', code: error.code, text: error.detail };
  }
  return {
    status: 'failed',
    code: 'drive.failed',
    text: error instanceof Error ? error.message : String(error),
  };
}

function toDto(row: DriveFetch): DriveFetchDto {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    fileName: row.fileName ?? null,
    sizeBytes: row.sizeBytes === null || row.sizeBytes === undefined ? null : Number(row.sizeBytes),
    bytesDownloaded: Number(row.bytesDownloaded),
    importId: row.importId ?? null,
    error: row.errorCode ? message(row.errorCode, row.error ? { text: row.error } : undefined) : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
