import { createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { pipeline } from 'node:stream/promises';

import yauzl from 'yauzl';

/**
 * Опознание выгрузки Apple Health и распаковка нужного из архива.
 *
 * Проверяется содержимое, а не имя файла: в общей папке лежит что угодно, и
 * `выгрузка.zip` вполне может оказаться фотографиями. Падать на чужом файле
 * нельзя — его надо отклонить и объяснить, почему.
 */

/** Имена основного файла выгрузки: iOS называет его на языке телефона. */
const EXPORT_NAMES = ['экспорт.xml', 'export.xml', 'Export.xml'];

/** Клинический формат дублирует основной и весит ещё гигабайт — он не нужен. */
const SKIP_NAMES = ['export_cda.xml'];

/** Сколько байт хватает, чтобы узнать корень XML. */
const PEEK_BYTES = 4096;

export interface Recognized {
  /** Путь к готовому к разбору XML. */
  xmlPath: string;
  /** Что это было: сам XML или архив, из которого его достали. */
  from: 'xml' | 'zip';
  /** Имя внутри архива — для журнала. */
  entryName?: string;
}

export class NotAnExport extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Начало файла: корень `HealthData` и характеристики HealthKit внутри. */
async function looksLikeHealthXml(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(PEEK_BYTES), 0, PEEK_BYTES, 0);
    const head = buffer.subarray(0, bytesRead).toString('utf8');
    return head.includes('<HealthData') || head.includes('HKCharacteristicType');
  } finally {
    await handle.close();
  }
}

const openZip = (path: string): Promise<yauzl.ZipFile> =>
  new Promise((resolve, reject) => {
    /*
     * `decodeStrings: false` — имена приходят байтами, а не строкой.
     *
     * iOS кладёт `экспорт.xml` в UTF-8, но не ставит в записи флаг UTF-8 (бит 11
     * общего назначения). По стандарту это значит CP437, и любой честный
     * читатель — включая yauzl — получает `╤ì╨║╤ü╨┐╨╛╤Ç╤é.xml`. Выгрузка при этом
     * отклонялась как «архив без выгрузки».
     *
     * Разбирать имя самим безопасно: оно нужно только для сравнения с известным
     * списком и для журнала, а путь распаковки задаётся снаружи и из имени
     * внутри архива не строится.
     */
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: false }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('Архив не открылся'));
      else resolve(zip);
    });
  });

/** Имя записи: байты в UTF-8, каким его на самом деле и записали. */
function entryName(entry: yauzl.Entry): string {
  const raw = entry.fileName as unknown as Buffer | string;
  return Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
}

/**
 * Достать из архива основной XML выгрузки.
 *
 * Читается ровно одна запись — та, что нужна. Полная распаковка вытащила бы на
 * диск ещё гигабайт маршрутов тренировок и кардиограмм, которыми сервис не
 * пользуется.
 */
async function extractExport(zipPath: string, destination: string): Promise<Recognized> {
  const zip = await openZip(zipPath);

  return new Promise<Recognized>((resolve, reject) => {
    let found = false;

    const finish = (error: Error | null, result?: Recognized): void => {
      zip.close();
      if (error) reject(error);
      else if (result) resolve(result);
    };

    zip.on('entry', (entry: yauzl.Entry) => {
      const full = entryName(entry);
      const name = basename(full);
      const wanted = EXPORT_NAMES.includes(name) && !SKIP_NAMES.includes(name);
      if (!wanted) {
        zip.readEntry();
        return;
      }

      found = true;
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          finish(error ?? new Error('Не удалось прочитать запись архива'));
          return;
        }
        pipeline(stream, createWriteStream(destination))
          .then(() => finish(null, { xmlPath: destination, from: 'zip', entryName: full }))
          .catch((cause: Error) => finish(cause));
      });
    });

    zip.on('end', () => {
      if (!found) {
        finish(new NotAnExport('drive.no-export-in-zip'));
      }
    });

    zip.on('error', (error: Error) => finish(error));
    zip.readEntry();
  });
}

/** Первые байты файла: `PK` — признак zip, вне зависимости от имени. */
async function isZip(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  } finally {
    await handle.close();
  }
}

/**
 * Привести скачанное к виду, пригодному для разбора.
 *
 * Архив — распаковать нужное; XML — проверить и оставить как есть; что-то
 * третье — отклонить.
 */
export async function recognizeExport(path: string, xmlDestination: string): Promise<Recognized> {
  if (await isZip(path)) {
    const result = await extractExport(path, xmlDestination);
    if (!(await looksLikeHealthXml(result.xmlPath))) {
      await rm(result.xmlPath, { force: true });
      throw new NotAnExport('drive.zip-not-health');
    }
    return result;
  }

  if (await looksLikeHealthXml(path)) return { xmlPath: path, from: 'xml' };

  throw new NotAnExport('drive.not-health-xml');
}
