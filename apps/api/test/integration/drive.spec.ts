import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import archiver from 'archiver';
import { createServer, type Server } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account, DriveFetch, HealthDaily, HealthImport } from '../../src/database/entities';
import type { AppConfigService } from '../../src/config/app-config.service';
import { AppleHealthService } from '../../src/modules/apple-health/apple-health.service';
import { DriveService } from '../../src/modules/drive/drive.service';
import { createTestOrm, testConfig } from '../orm-test';

/**
 * Загрузка выгрузки из Google Drive — от папки до строк в базе.
 *
 * Drive поднимается подставной: настоящий требует ключа, сети и живой папки, а
 * проверять надо не его, а решения сервиса — что считать выгрузкой, когда
 * качать, когда не качать.
 */
const FIXTURES = resolve(__dirname, '../fixtures');

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  md5Checksum?: string;
  modifiedTime: string;
  parent?: string;
  /** Что отдавать по `alt=media`. */
  path?: string;
}

/** Подставной Drive: список папки и выдача файла. Ключ проверяется как настоящим. */
class FakeDrive {
  private server?: Server;
  readonly files: FakeFile[] = [];
  requests = 0;

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      this.requests += 1;
      const url = new URL(request.url ?? '/', 'http://localhost');

      // как настоящий: пускает и по ключу в строке, и по токену в заголовке
      const authorized =
        Boolean(url.searchParams.get('key')) || Boolean(request.headers.authorization);
      if (!authorized) {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'нет ключа' } }));
        return;
      }

      const listing = url.pathname.endsWith('/files');
      if (listing) {
        const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q') ?? '')?.[1];
        const files = this.files.filter((file) => file.parent === parent);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ files }));
        return;
      }

      const id = url.pathname.split('/').pop();
      const file = this.files.find((item) => item.id === id);
      if (!file) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'нет такого' } }));
        return;
      }

      if (url.searchParams.get('alt') === 'media' && file.path) {
        response.writeHead(200);
        createReadStream(file.path).pipe(response);
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(file));
    });

    await new Promise<void>((done) => this.server!.listen(0, '127.0.0.1', done));
    const address = this.server!.address();
    if (typeof address === 'string' || !address) throw new Error('порт не выдан');
    return `http://127.0.0.1:${address.port}/drive/v3`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((done) => this.server?.close(() => done()));
  }
}

const HEALTH_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="ru_RU">\n' +
  ' <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-06-04"/>\n' +
  ' <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Часы" unit="count"' +
  ' startDate="2026-08-20 10:00:00 +0300" endDate="2026-08-20 11:00:00 +0300" value="2500"/>\n' +
  '</HealthData>\n';

describe('загрузка выгрузки из Google Drive', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let drive: DriveService;
  let health: AppleHealthService;
  let fake: FakeDrive;
  let account: Account;
  let dir = '';
  let zipPath = '';

  beforeAll(async () => {
    orm = await createTestOrm('drive');
    dir = await mkdtemp(join(tmpdir(), 'fatoff-drive-it-'));

    // архив, какой отдаёт iOS: нужный XML плюс ненужный клинический
    zipPath = join(dir, 'экспорт.zip');
    const archive = archiver('zip');
    const written = new Promise<void>((done, fail) => {
      const out = createWriteStream(zipPath);
      out.on('close', () => done());
      archive.on('error', fail);
      archive.pipe(out);
    });
    archive.append(HEALTH_XML, { name: 'apple_health_export/экспорт.xml' });
    archive.append('<ClinicalDocument/>', { name: 'apple_health_export/export_cda.xml' });
    await archive.finalize();
    await written;
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();

    fake = new FakeDrive();
    const base = await fake.start();

    const cfg = testConfig({
      HEALTH_DIR: FIXTURES,
      EXPORT_DIR: join(dir, 'exports'),
      GOOGLE_API_KEY: 'ключ-для-теста',
      DRIVE_API_BASE: base,
    });
    health = new AppleHealthService(em, cfg as unknown as AppConfigService);
    drive = new DriveService(em, cfg as unknown as AppConfigService, health);

    account = em.create(Account, {
      email: 'drive@example.com',
      label: 'тестовый',
      passwordEnc: null,
      profile: null,
      syncEnabled: false,
      driveEnabled: true,
      driveUrl: 'https://drive.google.com/drive/folders/1FolderAaBbCcDdEeFfGgHh0001',
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persistAndFlush(account);
  });

  afterEach(async () => {
    await fake.stop();
  });

  const putExport = (over: Partial<FakeFile> = {}): void => {
    fake.files.push({
      id: '1FileAaBbCcDdEeFf0001',
      name: 'экспорт.zip',
      mimeType: 'application/zip',
      size: 1024,
      md5Checksum: 'сумма-один',
      modifiedTime: '2026-08-29T06:00:00.000Z',
      parent: '1FolderAaBbCcDdEeFfGgHh0001',
      path: zipPath,
      ...over,
    });
  };

  /**
   * Дождаться конца загрузки, а не запускать её повторно.
   *
   * `start` уже запустил разбор в фоне; второй `execute` на той же записи
   * вставил бы те же строки ещё раз и упал на уникальном ключе — что и
   * произошло, когда тест звал его напрямую.
   */
  const waitForImport = async (importId: string): Promise<HealthImport> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = await em.fork().findOne(HealthImport, { id: importId });
      if (!record) throw new Error('загрузка не создалась');
      if (record.status !== 'queued' && record.status !== 'running') return record;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('загрузка не закончилась за отведённое время');
  };

  it('находит выгрузку в папке, скачивает и запускает загрузку', async () => {
    putExport();

    const result = await drive.check(account.id, 'manual');

    expect({ status: result.status, name: result.fileName }).toEqual({
      status: 'imported',
      name: 'экспорт.zip',
    });
    expect(result.bytesDownloaded).toBeGreaterThan(0);
    expect(result.importId).not.toBeNull();

    const imported = await waitForImport(result.importId!);
    expect({ status: imported.status, error: imported.error }).toEqual({
      status: 'done',
      error: null,
    });
    // имя показывается то, под которым файл лежит в Drive, а не внутреннее
    expect(imported.fileLabel).toBe('экспорт.zip');

    const days = await em.fork().count(HealthDaily, { account: account.id });
    expect(days).toBeGreaterThan(0);
  });

  it('второй раз тот же файл не качает', async () => {
    putExport();
    const first = await drive.check(account.id, 'manual');
    await waitForImport(first.importId!);

    const requestsAfterFirst = fake.requests;
    const second = await drive.check(account.id, 'schedule');

    expect(second.status).toBe('same');
    expect(second.importId).toBeNull();
    // список папки спросили, а файл — нет: разбирать те же два гигабайта незачем
    expect(fake.requests - requestsAfterFirst).toBeLessThanOrEqual(2);
  });

  it('изменившийся файл забирает заново', async () => {
    putExport();
    const first = await drive.check(account.id, 'manual');
    await waitForImport(first.importId!);

    fake.files.length = 0;
    putExport({ id: '1FileZzYyXxWwVvUu0002', md5Checksum: 'сумма-два', modifiedTime: '2026-08-30T06:00:00.000Z' });

    const second = await drive.check(account.id, 'schedule');
    expect(second.status).toBe('imported');
  });

  it('чужой файл отклоняет, а не падает на нём', async () => {
    const alien = join(dir, 'чужой.txt');
    await new Promise<void>((done) => {
      const out = createWriteStream(alien);
      out.end('это не выгрузка', () => done());
    });
    fake.files.push({
      id: '1FileAlienQqRrSsTt0003',
      name: 'заметки.xml',
      mimeType: 'text/xml',
      size: 20,
      md5Checksum: 'сумма-чужая',
      modifiedTime: '2026-08-29T07:00:00.000Z',
      parent: '1FolderAaBbCcDdEeFfGgHh0001',
      path: alien,
    });

    const result = await drive.check(account.id, 'manual');

    expect(result.status).toBe('rejected');
    // код, а не фраза: текст собирает интерфейс на своём языке (D-044)
    expect(result.error?.code).toBe('drive.not-health-xml');
    expect(await em.fork().count(HealthImport, {})).toBe(0);
  });

  it('пустую папку не считает бедой', async () => {
    const result = await drive.check(account.id, 'schedule');

    expect({ status: result.status, error: result.error }).toEqual({ status: 'empty', error: null });
  });

  it('без ключа честно говорит, что не настроен', async () => {
    const cfg = testConfig({
      HEALTH_DIR: FIXTURES,
      EXPORT_DIR: join(dir, 'exports'),
      GOOGLE_API_KEY: '',
      GOOGLE_SERVICE_ACCOUNT_FILE: '',
    });
    const without = new DriveService(em, cfg as unknown as AppConfigService, health);

    const settings = await without.settings(account.id);
    expect({ configured: settings.keyConfigured, access: settings.access }).toEqual({
      configured: false,
      access: null,
    });

    const result = await without.check(account.id, 'manual');
    expect({ status: result.status, code: result.error?.code }).toEqual({
      status: 'failed',
      code: 'drive.no-key',
    });
  });

  it('ссылку проверяет при сохранении, а не через сутки на расписании', async () => {
    await expect(drive.saveSettings(account.id, { url: 'https://example.com/файл' })).rejects.toThrow(
      /ссылку Google Drive/,
    );
    await expect(drive.saveSettings(account.id, { dailyAt: '25:00' })).rejects.toThrow(/ЧЧ:ММ/);

    const saved = await drive.saveSettings(account.id, {
      url: 'https://drive.google.com/drive/folders/1FolderZzYyXxWwVvUuTtSs0002',
      dailyAt: '06:30',
      enabled: true,
    });
    expect({ at: saved.dailyAt, on: saved.enabled }).toEqual({ at: '06:30', on: true });
  });

  it('говорит, чем именно открывает папку', async () => {
    const settings = await drive.settings(account.id);
    expect({ configured: settings.keyConfigured, access: settings.access }).toEqual({
      configured: true,
      access: 'api-key',
    });
  });

  it('журнал помнит и то, что делать ничего не пришлось', async () => {
    putExport();
    await drive.check(account.id, 'manual');
    await drive.check(account.id, 'schedule');

    const history = await drive.history(account.id);
    expect(history.map((row) => row.trigger)).toEqual(['schedule', 'manual']);
    expect(await em.fork().count(DriveFetch, { account: account.id })).toBe(2);
  });
});
