import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type CreateExportRequest,
  type Dataset,
  type ExportFileDto,
  type ExportFormat,
  type Granularity,
} from '@fatoff/contracts';

import { assertIsoDate, today as todayOf } from '../../common/date.util';
import { AppConfigService } from '../../config/app-config.service';
import { Account, ExportFile } from '../../database/entities';
import { resolveDatasets } from '../sync/sync-plan';
import { buildTables } from './build';
import { ExportLoader } from './loader';
import { renderCsv } from './renderers/csv';
import { renderJson } from './renderers/json';
import { renderMarkdown } from './renderers/markdown';
import { renderToon } from './renderers/toon';
import type { Table } from './table';

const TOOL_VERSION = '0.1.0';

interface OutputFile {
  name: string;
  content: string;
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly cfg: AppConfigService,
    private readonly loader: ExportLoader,
  ) {}

  /** Каталог выгрузок; относительный путь считается от рабочего каталога backend. */
  private get root(): string {
    return resolve(process.cwd(), this.cfg.get('EXPORT_DIR'));
  }

  async create(accountId: string, request: CreateExportRequest): Promise<ExportFileDto> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    if (request.formats.length === 0) throw new Error('Не выбран ни один формат');

    const to = assertIsoDate(request.to ?? todayOf(), 'Конец периода');
    const from = assertIsoDate(request.from ?? account.registrationDate ?? to, 'Начало периода');
    if (from > to) throw new Error(`Начало периода ${from} позже конца ${to}`);

    const datasets = resolveDatasets(request.datasets);
    const granularity: Granularity = request.granularity ?? 'auto';
    const redact = request.redact ?? false;
    const includeHealth = request.includeHealth ?? true;

    const record = this.em.create(ExportFile, {
      account,
      dateFrom: from,
      dateTo: to,
      datasets,
      formats: request.formats,
      granularity,
      redact,
      includeHealth,
      status: 'running',
      tables: [],
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(record);

    try {
      const { files, tables } = await this.render(account, from, to, datasets, {
        formats: request.formats,
        granularity,
        redact,
        includeHealth,
      });

      const { fileName, filePath, sizeBytes } = await this.write(record.id, account, from, to, files);

      record.status = 'done';
      record.fileName = fileName;
      record.filePath = filePath;
      record.sizeBytes = sizeBytes;
      record.tables = tables.map((table) => ({
        name: table.name,
        rows: table.rows.length,
        columns: table.columns.length,
      }));
      record.finishedAt = new Date();
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      record.finishedAt = new Date();
      await this.em.flush();
      throw error;
    }

    await this.em.flush();
    return this.toDto(record, account);
  }

  /** Сборка содержимого. Отдельно от записи на диск — так её можно проверить без файловой системы. */
  private async render(
    account: Account,
    from: string,
    to: string,
    datasets: Dataset[],
    options: {
      formats: ExportFormat[];
      granularity: Granularity;
      redact: boolean;
      includeHealth: boolean;
    },
  ): Promise<{ files: OutputFile[]; tables: Table[] }> {
    const source = await this.loader.load(account, from, to, new Set(datasets), {
      redact: options.redact,
      includeHealth: options.includeHealth,
    });
    const built = buildTables(source, {
      toolVersion: TOOL_VERSION,
      apiVersion: this.cfg.get('YAZIO_API_VERSION'),
      account: account.label ?? account.email,
      generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });

    const files: OutputFile[] = [];

    for (const format of options.formats) {
      switch (format) {
        case 'markdown':
          files.push({
            name: 'digest.md',
            content: renderMarkdown(source, built.entries, built.meta, built.warnings, {
              granularity: options.granularity,
              accountLabel: account.label ?? account.email,
            }),
          });
          break;
        case 'json':
          files.push({ name: 'export.json', content: renderJson(built.tables) });
          break;
        case 'toon':
          files.push({ name: 'export.toon', content: renderToon(built.tables) });
          break;
        case 'csv':
          // у CSV нет честного способа сложить разные схемы в один файл
          for (const table of built.tables) {
            files.push({ name: `${table.name}.csv`, content: renderCsv(table) });
          }
          break;
      }
    }

    return { files, tables: built.tables };
  }

  /** Один файл отдаётся как есть, несколько — упаковываются в zip. */
  private async write(
    exportId: string,
    account: Account,
    from: string,
    to: string,
    files: OutputFile[],
  ): Promise<{ fileName: string; filePath: string; sizeBytes: number }> {
    const dir = join(this.root, exportId);
    await mkdir(dir, { recursive: true });

    const base = `yazio-${slug(account.label ?? account.email)}-${from}_${to}`;

    if (files.length === 1) {
      const single = files[0];
      const fileName = `${base}${extensionOf(single.name)}`;
      const path = join(dir, fileName);
      await writeFile(path, single.content, 'utf8');
      return { fileName, filePath: join(exportId, fileName), sizeBytes: (await stat(path)).size };
    }

    const fileName = `${base}.zip`;
    const path = join(dir, fileName);
    await this.zip(path, files);
    return { fileName, filePath: join(exportId, fileName), sizeBytes: (await stat(path)).size };
  }

  private zip(path: string, files: OutputFile[]): Promise<void> {
    return new Promise((done, fail) => {
      const output = createWriteStream(path);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => done());
      archive.on('error', fail);
      output.on('error', fail);

      archive.pipe(output);
      for (const file of files) archive.append(file.content, { name: file.name });
      void archive.finalize();
    });
  }

  async list(accountId?: string): Promise<ExportFileDto[]> {
    const records = await this.em.find(
      ExportFile,
      accountId ? { account: accountId } : {},
      { orderBy: { createdAt: 'desc' }, limit: 100, populate: ['account'] },
    );
    return records.map((record) => this.toDto(record, record.account));
  }

  async detail(id: string): Promise<ExportFileDto> {
    const record = await this.findOne(id);
    return this.toDto(record, record.account);
  }

  /** Путь к готовому файлу для отдачи. */
  async fileFor(id: string): Promise<{ path: string; fileName: string }> {
    const record = await this.findOne(id);
    if (record.status !== 'done' || !record.filePath || !record.fileName) {
      throw new Error(`Файл выгрузки ${id} не найден: сборка не завершилась`);
    }

    const path = join(this.root, record.filePath);
    try {
      await stat(path);
    } catch {
      throw new Error(`Файл выгрузки ${id} не найден на диске`);
    }
    return { path, fileName: record.fileName };
  }

  async remove(id: string): Promise<void> {
    const record = await this.findOne(id);
    await rm(join(this.root, record.id), { recursive: true, force: true });
    await this.em.removeAndFlush(record);
  }

  /**
   * Удаление устаревших выгрузок. Файлы копятся быстро, а нужны обычно один раз —
   * ровно тогда, когда их скачали.
   */
  async cleanup(): Promise<number> {
    const days = this.cfg.get('EXPORT_RETENTION_DAYS');
    if (days <= 0) return 0;

    const edge = new Date(Date.now() - days * 86_400_000);
    const stale = await this.em.find(ExportFile, { createdAt: { $lt: edge } });

    for (const record of stale) {
      await rm(join(this.root, record.id), { recursive: true, force: true });
      this.em.remove(record);
    }
    await this.em.flush();

    if (stale.length > 0) this.logger.log(`Удалено выгрузок по сроку хранения: ${stale.length}`);
    return stale.length;
  }

  private async findOne(id: string): Promise<ExportFile> {
    const record = await this.em.findOne(ExportFile, { id }, { populate: ['account'] });
    if (!record) throw new Error(`Выгрузка ${id} не найдена`);
    return record;
  }

  private toDto(record: ExportFile, account: Account): ExportFileDto {
    return {
      id: record.id,
      accountId: account.id,
      accountLabel: account.label ?? account.email,
      from: record.dateFrom,
      to: record.dateTo,
      formats: record.formats,
      datasets: record.datasets,
      redact: record.redact,
      includeHealth: record.includeHealth,
      fileName: record.fileName ?? '',
      sizeBytes: Number(record.sizeBytes ?? 0),
      tables: record.tables,
      status: record.status,
      error: record.error,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'account'
  );
}
