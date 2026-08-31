/**
 * Чтение `.env` для служебных скриптов.
 *
 * Идентификаторы папок, адреса контуров и номер группы — личные: в открытый
 * репозиторий они не едут, поэтому живут в `.env`, а образец лежит в
 * `.env.example`. Скрипты запускаются руками, без Nest и его конфигурации,
 * поэтому читают файл сами — шесть строк вместо зависимости.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function envValue(key) {
  const path = resolve(new URL('..', import.meta.url).pathname, '.env');
  const text = readFileSync(path, 'utf8');
  const line = text.split('\n').find((row) => row.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).split('#')[0].trim() : '';
}
