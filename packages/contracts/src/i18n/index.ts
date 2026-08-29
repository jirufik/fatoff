import type { Locale, Message, Text } from '../common.js';

import { EN } from './en.js';
import { RU } from './ru.js';

export { EN, RU };

export const LOCALES: Locale[] = ['ru', 'en'];

const DICTS: Record<Locale, Record<string, string>> = { ru: RU, en: EN };

/**
 * Перевод по ключу с подстановками в фигурных скобках.
 *
 * Словари лежат здесь, а не во фронте, потому что тот же текст нужен серверу,
 * когда он собирает PDF. Две копии словаря разъехались бы на первой же правке
 * формулировки — и заметили бы это только в готовом файле.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = DICTS[locale]?.[key] ?? RU[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  );
}

/**
 * Сообщение от сервера: код плюс подстановки.
 *
 * Строка принимается тоже: в планах, сохранённых до перехода на коды, лежит
 * готовая русская фраза. Отдать её как есть честнее, чем показать
 * `msg.undefined` вместо предупреждения.
 */
export function translateMessage(locale: Locale, entry: Message | string): string {
  if (typeof entry === 'string') return entry;
  if (!entry?.code) return '';
  return translate(locale, `msg.${entry.code}`, entry.params);
}

/** Двуязычное поле справочника; строка возвращается как есть. */
export function pickText(locale: Locale, value: Text | string | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : (value[locale] ?? value.ru);
}

/** Единица измерения: сервер отдаёт ключ, а не подпись. */
export function unitLabel(locale: Locale, unit: string): string {
  const known: Record<string, string> = { g: 'unit.g', ml: 'unit.ml', portion: 'unit.portion' };
  return known[unit] ? translate(locale, known[unit]) : unit;
}
