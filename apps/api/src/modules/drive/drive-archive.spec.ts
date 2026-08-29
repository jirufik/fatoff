import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { NotAnExport, recognizeExport } from './drive-archive';

/**
 * Опознание выгрузки по содержимому, а не по имени.
 *
 * В общей папке лежит что угодно, и `выгрузка.zip` вполне может оказаться
 * фотографиями. Падать на чужом файле нельзя — его надо отклонить и объяснить.
 */
const HEALTH_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE HealthData [ ]>\n' +
  '<HealthData locale="ru_RU">\n' +
  ' <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-06-04"/>\n' +
  ' <Record type="HKQuantityTypeIdentifierStepCount" value="1000"/>\n' +
  '</HealthData>\n';

let dir = '';

const zipOf = async (entries: Array<[string, string]>, name: string): Promise<string> => {
  const path = join(dir, name);
  const archive = archiver('zip');
  const done = new Promise<void>((resolve, reject) => {
    const out = createWriteStream(path);
    out.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(out);
  });
  for (const [entry, text] of entries) archive.append(text, { name: entry });
  await archive.finalize();
  await done;
  return path;
};

/**
 * Архив с именем в UTF-8, но **без флага UTF-8** — так пишет iOS.
 *
 * Ни `archiver`, ни `zipfile` такой архив не соберут: они честно ставят бит 11
 * для не-ASCII имени. Поэтому запись складывается вручную — заголовок,
 * несжатые данные, центральный каталог. Ровно на этом архиве выгрузка и
 * отклонялась как «архив без выгрузки».
 */
function zipWithoutUtf8Flag(entry: string, content: string): Buffer {
  const name = Buffer.from(entry, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // версия
  local.writeUInt16LE(0, 6); // флаги: бит UTF-8 намеренно не выставлен
  local.writeUInt16LE(0, 8); // без сжатия
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); // и здесь тоже нет
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);

  const localSize = local.length + name.length + data.length;
  const centralSize = central.length + name.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);

  return Buffer.concat([local, name, data, central, name, end]);
}

/** Таблица CRC-32 нужна только этому вспомогательному сборщику архива. */
function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fatoff-drive-'));
});

describe('опознание выгрузки Apple Health', () => {
  it('достаёт основной XML из архива, как его называет iOS', async () => {
    for (const entry of ['apple_health_export/экспорт.xml', 'apple_health_export/export.xml']) {
      const zip = await zipOf(
        [
          [entry, HEALTH_XML],
          // клинический формат весит ещё гигабайт и не нужен
          ['apple_health_export/export_cda.xml', '<ClinicalDocument/>'],
        ],
        `${encodeURIComponent(entry)}.zip`,
      );

      const out = join(dir, `${encodeURIComponent(entry)}.xml`);
      const result = await recognizeExport(zip, out);

      expect({ from: result.from, entry: result.entryName }).toEqual({ from: 'zip', entry });
      expect(await readFile(out, 'utf8')).toContain('<HealthData');
    }
  });

  it('принимает распакованный XML как есть', async () => {
    const xml = join(dir, 'экспорт.xml');
    await writeFile(xml, HEALTH_XML);

    expect(await recognizeExport(xml, join(dir, 'unused.xml'))).toEqual({
      xmlPath: xml,
      from: 'xml',
    });
  });

  it('отклоняет архив без выгрузки, называя причину кодом', async () => {
    const zip = await zipOf([['фото/котик.txt', 'мяу']], 'чужой.zip');

    // код, а не фраза: текст собирает интерфейс на своём языке (D-044)
    await expect(recognizeExport(zip, join(dir, 'out.xml'))).rejects.toMatchObject({
      code: 'drive.no-export-in-zip',
    });
    await expect(recognizeExport(zip, join(dir, 'out.xml'))).rejects.toThrow(NotAnExport);
  });

  it('отклоняет посторонний файл, даже если он назван как выгрузка', async () => {
    const fake = join(dir, 'экспорт-подделка.xml');
    await writeFile(fake, '<rss><channel><title>не то</title></channel></rss>');

    await expect(recognizeExport(fake, join(dir, 'out2.xml'))).rejects.toMatchObject({
      code: 'drive.not-health-xml',
    });
  });

  it('читает кириллическое имя, даже когда в архиве не выставлен флаг UTF-8', async () => {
    // iOS кладёт «экспорт.xml» в UTF-8, но флаг не ставит. По стандарту это
    // значит CP437, и имя читается как «╤ì╨║╤ü╨┐╨╛╤Ç╤é.xml» — выгрузка
    // отклонялась как «архив без выгрузки»
    const path = join(dir, 'ios-стиль.zip');
    await writeFile(path, zipWithoutUtf8Flag('apple_health_export/экспорт.xml', HEALTH_XML));

    const out = join(dir, 'ios-стиль.xml');
    const result = await recognizeExport(path, out);

    expect({ from: result.from, entry: result.entryName }).toEqual({
      from: 'zip',
      entry: 'apple_health_export/экспорт.xml',
    });
    expect(await readFile(out, 'utf8')).toContain('<HealthData');
  });

  it('узнаёт архив по содержимому, а не по расширению', async () => {
    const zip = await zipOf([['apple_health_export/экспорт.xml', HEALTH_XML]], 'без-расширения');

    const result = await recognizeExport(zip, join(dir, 'out3.xml'));
    expect(result.from).toBe('zip');
  });
});
