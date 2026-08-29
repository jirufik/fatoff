import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { commitRefusal, environmentOf, mergeRefusal } from './branch-rules.mjs';

/**
 * Правило веток проверяется тестом, а не пересказом в документации.
 *
 * Хуки его только зовут: если правило перестанет запрещать то, что должно, —
 * узнать об этом хочется здесь, а не по образу вчерашней сборки в проде.
 */
describe('правила веток', () => {
  it('в main пускает только develop', () => {
    assert.equal(mergeRefusal('main', 'develop'), null);

    for (const from of ['feature/pdf', 'hotfix/1', 'main', 'какая-то-ветка']) {
      assert.ok(mergeRefusal('main', from), `«${from}» в main пускать нельзя`);
      assert.match(mergeRefusal('main', from), /сливается только develop/);
    }
  });

  it('в develop пускает что угодно: он для того и заведён', () => {
    for (const from of ['feature/pdf', 'fix/mobile', 'main']) {
      assert.equal(mergeRefusal('develop', from), null);
    }
  });

  it('фича-ветки между собой не ограничивает', () => {
    assert.equal(mergeRefusal('feature/a', 'feature/b'), null);
    assert.equal(mergeRefusal('feature/a', 'develop'), null);
  });

  it('прямой коммит в main запрещает, в остальные — нет', () => {
    assert.match(commitRefusal('main'), /Прямой коммит в main запрещён/);
    assert.equal(commitRefusal('develop'), null);
    assert.equal(commitRefusal('feature/pdf'), null);
  });

  it('каждой ветке сопоставлен свой контур, фича-веткам — никакой', () => {
    assert.deepEqual(
      { name: environmentOf('main').name, port: environmentOf('main').port },
      { name: 'прод', port: 4090 },
    );
    assert.deepEqual(
      { name: environmentOf('develop').name, port: environmentOf('develop').port },
      { name: 'develop', port: 4092 },
    );
    assert.equal(environmentOf('feature/pdf'), null);

    // контуры не должны делить порт: это была бы ровно та беда, от которой ушли
    assert.notEqual(environmentOf('main').port, environmentOf('develop').port);
  });
});
