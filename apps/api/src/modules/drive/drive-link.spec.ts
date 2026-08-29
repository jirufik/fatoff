import { describe, expect, it } from 'vitest';

import { parseDriveLink } from './drive-link';

/**
 * Ссылку копирует человек, и видов у неё много.
 *
 * Разбор — чистая функция, поэтому все виды проверяются разом. Ошибка здесь
 * проявилась бы через сутки на расписании, в худший из возможных моментов.
 */
describe('разбор ссылки на Google Drive', () => {
  it('узнаёт папку во всех привычных видах', () => {
    const folder = '1AbC-dEfGhIjKlMnOpQrStUvWxYz012';
    for (const link of [
      `https://drive.google.com/drive/folders/${folder}`,
      `https://drive.google.com/drive/folders/${folder}?usp=sharing`,
      `https://drive.google.com/drive/u/0/folders/${folder}`,
      `  https://drive.google.com/drive/folders/${folder}  `,
    ]) {
      expect({ link, parsed: parseDriveLink(link) }).toEqual({
        link,
        parsed: { kind: 'folder', id: folder },
      });
    }
  });

  it('узнаёт отдельный файл', () => {
    const file = '1ZzYyXxWwVvUuTtSsRrQqPpOoNn98765';
    expect(parseDriveLink(`https://drive.google.com/file/d/${file}/view?usp=drive_link`)).toEqual({
      kind: 'file',
      id: file,
    });
    expect(parseDriveLink(`https://drive.google.com/uc?export=download&id=${file}`)).toEqual({
      kind: 'file',
      id: file,
    });
  });

  it('принимает голый идентификатор, считая его папкой', () => {
    // отличить папку от файла умеет только сам Drive, и он это и сделает
    expect(parseDriveLink('1AbC-dEfGhIjKlMnOpQrStUvWxYz012')).toEqual({
      kind: 'folder',
      id: '1AbC-dEfGhIjKlMnOpQrStUvWxYz012',
    });
  });

  it('на чужую ссылку отвечает «не знаю», а не исключением', () => {
    for (const link of ['', '   ', 'https://example.com/файл.zip', 'просто текст', 'короткий']) {
      expect({ link, parsed: parseDriveLink(link) }).toEqual({ link, parsed: null });
    }
  });
});
