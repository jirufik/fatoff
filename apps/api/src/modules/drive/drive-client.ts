import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { DriveAuth } from './drive-auth';

/**
 * Тонкий клиент Google Drive API v3 — ровно на три операции.
 *
 * Библиотеки `googleapis` здесь не хватает только веса: она тянет за собой
 * OAuth, генерацию клиентов и полсотни мегабайт зависимостей ради трёх
 * запросов, которым нужен один ключ в строке адреса.
 *
 * Ключ даёт доступ только к тому, что и так открыто по ссылке. Приватную папку
 * им не откроешь, и это правильно: сервис не должен уметь больше, чем ему дали.
 */

const API = 'https://www.googleapis.com/drive/v3';

/** Поля, которые спрашиваем у Drive. Лишние он не отдаёт, и это к лучшему. */
const FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Размер в байтах; у папок и документов Google его нет. */
  sizeBytes: number | null;
  /** Контрольная сумма; у документов Google её нет. */
  md5: string | null;
  modifiedAt: string | null;
}

export class DriveError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(detail ?? code);
  }
}

export class DriveClient {
  /**
   * Адрес API отделён от кода намеренно: тесты поднимают подставной Drive и
   * проверяют решения сервиса, а не доступность Google.
   */
  constructor(
    private readonly auth: DriveAuth,
    private readonly base: string = API,
  ) {}

  private async request(path: string, params: Record<string, string>): Promise<Response> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (const [key, value] of Object.entries(this.auth.params())) url.searchParams.set(key, value);

    const response = await fetch(url, {
      headers: { accept: 'application/json', ...(await this.auth.headers()) },
    });
    if (response.ok) return response;

    // ответ Drive объясняет причину лучше кода состояния, но не всегда приходит
    const detail = await response
      .json()
      .then((body) => (body as { error?: { message?: string } })?.error?.message)
      .catch(() => undefined);

    if (response.status === 403) throw new DriveError('drive.forbidden', detail, 403);
    if (response.status === 404) throw new DriveError('drive.not-found', detail, 404);
    throw new DriveError('drive.http', detail ?? String(response.status), response.status);
  }

  private static toFile(raw: Record<string, unknown>): DriveFile {
    return {
      id: String(raw.id),
      name: String(raw.name ?? ''),
      mimeType: String(raw.mimeType ?? ''),
      sizeBytes: raw.size === undefined ? null : Number(raw.size),
      md5: raw.md5Checksum === undefined ? null : String(raw.md5Checksum),
      modifiedAt: raw.modifiedTime === undefined ? null : String(raw.modifiedTime),
    };
  }

  async meta(fileId: string): Promise<DriveFile> {
    const response = await this.request(`/files/${fileId}`, { fields: FIELDS });
    return DriveClient.toFile((await response.json()) as Record<string, unknown>);
  }

  /** Что лежит в папке. Корзина исключена, порядок — свежие первыми. */
  async list(folderId: string): Promise<DriveFile[]> {
    const response = await this.request('/files', {
      q: `'${folderId}' in parents and trashed = false`,
      fields: `files(${FIELDS})`,
      orderBy: 'modifiedTime desc',
      pageSize: '100',
    });

    const body = (await response.json()) as { files?: Array<Record<string, unknown>> };
    return (body.files ?? []).map((file) => DriveClient.toFile(file));
  }

  /**
   * Скачать файл на диск потоком.
   *
   * Именно потоком: выгрузка Apple Health — сотни мегабайт, и держать её в
   * памяти незачем. Обратный вызов зовётся по мере чтения, чтобы в интерфейсе
   * было видно, что загрузка идёт, а не висит.
   */
  async download(
    fileId: string,
    destination: string,
    onProgress?: (bytes: number) => void,
  ): Promise<number> {
    const response = await this.request(`/files/${fileId}`, { alt: 'media' });
    if (!response.body) throw new DriveError('drive.empty-body');

    let received = 0;
    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      onProgress?.(received);
    });

    await pipeline(source, createWriteStream(destination));
    return received;
  }
}
