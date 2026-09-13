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
  return template
    .replace(/\{(\w+):([^{}]+)\}/g, (whole, name: string, forms: string) =>
      params[name] === undefined ? whole : pluralForm(locale, params[name], forms.split('|')),
    )
    .replace(/\{(\w+)\}/g, (whole, name: string) =>
      params[name] === undefined ? whole : String(params[name]),
    );
}

/**
 * Слово, согласованное с числом: `{days:день|дня|дней}`.
 *
 * Подстановка печатает только слово — само число стоит в строке отдельно,
 * `{days}`. По-русски форм три (1 день, 2 дня, 5 дней), по-английски две (1 day,
 * 2 days). Без этого на экране выходило «82 дней» и «в 1 днях» — мелочь, по
 * которой видно, что текст собирала программа, а не человек (D-085).
 *
 * Число приходит и строкой с пробелами между тысячами: так их пишет сервер.
 */
export function pluralForm(locale: Locale, value: string | number, forms: string[]): string {
  const parsed =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/[\s\u00a0\u202f]/g, '').replace('−', '-').replace(',', '.'));
  const last = forms[forms.length - 1] ?? '';
  if (!Number.isFinite(parsed)) return last;
  const n = Math.abs(parsed);

  if (locale === 'ru') {
    // дробное согласуется с родительным единственного: «1.5 дня»
    if (!Number.isInteger(n)) return forms[1] ?? last;
    const ones = n % 10;
    const tens = n % 100;
    if (ones === 1 && tens !== 11) return forms[0] ?? last;
    if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return forms[1] ?? last;
    return forms[2] ?? last;
  }
  return n === 1 ? (forms[0] ?? last) : (forms[1] ?? last);
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
