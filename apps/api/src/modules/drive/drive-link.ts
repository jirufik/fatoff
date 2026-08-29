/**
 * Разбор ссылки на Google Drive.
 *
 * Ссылку человек копирует из браузера или из кнопки «Поделиться», и видов у неё
 * несколько. Отдельный файл, потому что это чистая функция без сети: её можно
 * проверить тестами на всех видах ссылок разом, а не гадать в проде.
 */

export type DriveTargetKind = 'folder' | 'file';

export interface DriveTarget {
  kind: DriveTargetKind;
  id: string;
}

/** Идентификатор в Drive: буквы, цифры, дефис и подчёркивание, не короче десяти. */
const ID = '[\\w-]{10,}';

const PATTERNS: Array<{ re: RegExp; kind: DriveTargetKind }> = [
  { re: new RegExp(`/folders/(${ID})`), kind: 'folder' },
  { re: new RegExp(`/drive/u/\\d+/folders/(${ID})`), kind: 'folder' },
  { re: new RegExp(`/file/d/(${ID})`), kind: 'file' },
  { re: new RegExp(`/document/d/(${ID})`), kind: 'file' },
  { re: new RegExp(`[?&]id=(${ID})`), kind: 'file' },
];

/**
 * Что за ссылка и на что она указывает.
 *
 * Возвращает `null`, если это не Drive: молчаливое «ничего не нашли» лучше
 * исключения, потому что ссылку вводит человек и ошибиться в ней — обычное дело.
 */
export function parseDriveLink(raw: string): DriveTarget | null {
  const value = raw.trim();
  if (!value) return null;

  for (const { re, kind } of PATTERNS) {
    const found = value.match(re);
    if (found) return { kind, id: found[1] };
  }

  // голый идентификатор тоже принимаем: его копируют из адресной строки чаще,
  // чем кажется, а отличить папку от файла всё равно умеет только сам Drive
  if (new RegExp(`^${ID}$`).test(value)) return { kind: 'folder', id: value };

  return null;
}
