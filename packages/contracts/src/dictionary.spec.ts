import { describe, expect, it } from 'vitest';

import { BROWSE_TABLES, EXPORT_TABLES, READING_RULES, type TableDoc } from './dictionary.js';
import type { Text } from './common.js';
import { NUTRIENTS } from './nutrients.js';
import { PLANNER_SETTINGS, SETTING_GROUPS } from './planner-settings.js';

/**
 * Справочники — это данные в коде, и обе версии текста лежат в них рядом.
 *
 * Проверяется не формулировка, а то, из-за чего справочник врёт молча: пустая
 * половина (поле добавили, английский забыли) и английский, скопированный с
 * русского. Переключение языка в таком месте не даёт никакой ошибки — просто
 * на английском экране остаётся русский текст.
 */
const TABLES = [...BROWSE_TABLES, ...EXPORT_TABLES];

/**
 * Перечни значений поля одинаковы на обоих языках — их не переводят: строка
 * вроде `slice, piece, tablespoon…` не текст, а список того, что приходит от
 * YAZIO. Признак — латиница и типографские знаки, без единой буквы кириллицы.
 */
const SAME_ON_PURPOSE = /^[\x20-\x7E…—–·«»°µ×÷]*$/;

function texts(): Array<{ where: string; value: Text }> {
  const found: Array<{ where: string; value: Text }> = [];
  const add = (where: string, value: Text | null | undefined): void => {
    if (value) found.push({ where, value });
  };

  READING_RULES.forEach((rule, index) => add(`READING_RULES[${index}]`, rule));

  for (const table of TABLES as TableDoc[]) {
    add(`${table.name}.title`, table.title);
    add(`${table.name}.row`, table.row);
    add(`${table.name}.note`, table.note);
    for (const field of table.fields) {
      add(`${table.name}.${field.name}.title`, field.title);
      add(`${table.name}.${field.name}.note`, field.note);
    }
  }

  for (const nutrient of NUTRIENTS) add(`nutrient:${nutrient.column}`, nutrient.title);

  for (const group of SETTING_GROUPS) {
    add(`group:${group.key}.title`, group.title);
    add(`group:${group.key}.description`, group.description);
  }
  for (const spec of PLANNER_SETTINGS) {
    add(`setting:${spec.key}.title`, spec.title);
    add(`setting:${spec.key}.description`, spec.description);
    add(`setting:${spec.key}.unit`, spec.unit);
  }

  return found;
}

describe('двуязычные справочники', () => {
  it('у каждой записи заполнены обе половины', () => {
    const empty = texts()
      .filter(({ value }) => !value.ru?.trim() || !value.en?.trim())
      .map(({ where }) => where);

    expect(empty).toEqual([]);
  });

  it('английский не скопирован с русского', () => {
    const copied = texts()
      .filter(({ value }) => value.ru === value.en && !SAME_ON_PURPOSE.test(value.ru))
      .map(({ where }) => where);

    expect(copied).toEqual([]);
  });

  it('в английской половине не остаётся кириллицы', () => {
    const cyrillic = texts()
      .filter(({ value }) => /[а-яё]/i.test(value.en))
      .map(({ where }) => where);

    expect(cyrillic).toEqual([]);
  });

  it('таблицы описаны целиком: имя, строка и хотя бы одно поле', () => {
    for (const table of TABLES as TableDoc[]) {
      expect({ name: table.name, fields: table.fields.length > 0 }).toEqual({
        name: table.name,
        fields: true,
      });
    }
  });
});
