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

  it('узнаёт архив по содержимому, а не по расширению', async () => {
    const zip = await zipOf([['apple_health_export/экспорт.xml', HEALTH_XML]], 'без-расширения');

    const result = await recognizeExport(zip, join(dir, 'out3.xml'));
    expect(result.from).toBe('zip');
  });
});
