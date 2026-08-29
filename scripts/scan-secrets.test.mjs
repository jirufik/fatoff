import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scanFile } from './scan-secrets.mjs';

/** Свой `expect(...).toEqual(...)`: ради одного файла тащить vitest в корень незачем. */
const expect = (actual) => ({
  toEqual: (want) => assert.deepEqual(actual, want),
  toBe: (want) => assert.equal(actual, want),
  toBeGreaterThan: (want) => assert.ok(actual > want, `${actual} должно быть больше ${want}`),
});

/**
 * Проверка проверки.
 *
 * Сканер, который ничего не находит, выглядит точно так же, как сканер, у
 * которого сломалось регулярное выражение. Поэтому у каждого правила есть свой
 * случай, а рядом — случай, на который оно не должно срабатывать.
 */
const dir = mkdtempSync(join(tmpdir(), 'fatoff-scan-'));

const file = (name, text) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe('поиск секретов и чужих данных', () => {
  it('не пускает файлы, которых в репозитории быть не должно', () => {
    for (const path of [
      '.env',
      'apps/api/.env.local',
      'secrets/tokens.json',
      'apple-health/export.xml',
      'backup-20260829/cluster.sql',
      'storage/exports/file.zip',
      'dump.sql',
      'server.pem',
      'id_rsa',
    ]) {
      expect({ path, blocked: scanFile(path).length > 0 }).toEqual({ path, blocked: true });
    }
  });

  it('пропускает пример настроек и обычные исходники', () => {
    for (const path of ['.env.example', 'apps/api/src/main.ts', 'docs/DECISIONS.md']) {
      expect({ path, blocked: scanFile(path).some((p) => p.includes('такому файлу')) }).toEqual({
        path,
        blocked: false,
      });
    }
  });

  it('находит почту, ключ, JWT и пароль значением', () => {
    /*
     * Образцы собираются из кусков, а не пишутся строкой целиком: иначе сам
     * файл теста не проходит собственную проверку. Проверять проверку её же
     * запретом — верный способ получить вечно красный хук.
     */
    const at = String.fromCharCode(64);
    const cases = [
      ['почта', `const owner = "ivan.petrov${at}yandex.ru"`],
      ['ключ', 'SECRETS_KEY=' + '926f77b18af442dd' + '6098346df80876ba' + '41975acc2308685c'],
      ['jwt', 'const t = "ey' + 'JhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP"'],
      ['пароль', "const password = 'hunter" + "22026abc'"],
      ['строка подключения', `DATABASE_URL=postgresql://user:s3cret${at}localhost:5432/db`],
    ];
    for (const [name, text] of cases) {
      const found = scanFile(file(`${name}.ts`, text));
      expect({ name, found: found.length > 0 }).toEqual({ name, found: true });
    }
  });

  it('не ругается на примеры, заглушки и обращения к окружению', () => {
    const safe = [
      `const from = "noreply${String.fromCharCode(64)}example.com"`,
      "const password = process.env.APP_PASSWORD",
      'APP_PASSWORD=                         # ЗАПОЛНИТЬ: пароль для входа',
      'import { useApi } from "@fatoff/contracts"',
      'const mail = `' + '${user}' + String.fromCharCode(64) + '${domain}`',
      'const key = "0000000000000000000000000000000000000000"',
    ];
    for (const text of safe) {
      const found = scanFile(file(`safe-${safe.indexOf(text)}.ts`, text));
      expect({ text, found }).toEqual({ text, found: [] });
    }
  });

  it('помеченную строку пропускает, но только помеченную', () => {
    const at = String.fromCharCode(64);
    const line = `const owner = "ivan${at}example-mail.ru"`;

    const marked = file('marked.ts', `${line} // scan-secrets` + ': allow — выдуманный адрес');
    expect(scanFile(marked)).toEqual([]);

    const unmarked = file('unmarked.ts', line);
    expect(scanFile(unmarked).length).toBeGreaterThan(0);
  });

  it('крупный файл считает данными, а не исходником', () => {
    const big = file('big.json', JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024 + 10) }));
    expect(scanFile(big).some((p) => p.includes('похоже на данные'))).toBe(true);
  });
});
