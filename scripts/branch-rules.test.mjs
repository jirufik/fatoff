import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { commitRefusal, environmentOf, mergeRefusal } from './branch-rules.mjs';

/** Согласие человека: без него слияние в общую ветку не проходит (D-069). */
const OK = 'рюфус';

/**
 * Правило веток проверяется тестом, а не пересказом в документации.
 *
 * Хуки его только зовут: если правило перестанет запрещать то, что должно, —
 * узнать об этом хочется здесь, а не по образу вчерашней сборки в проде.
 */
describe('правила веток', () => {
  it('в main пускает только develop', () => {
    assert.equal(mergeRefusal('main', 'develop', OK), null);

    for (const from of ['feature/pdf', 'hotfix/1', 'main', 'какая-то-ветка']) {
      assert.ok(mergeRefusal('main', from, OK), `«${from}» в main пускать нельзя`);
      assert.match(mergeRefusal('main', from, OK), /сливается только develop/);
    }
  });

  it('в develop пускает ветки задач, но не общие ветки', () => {
    for (const from of ['feature/pdf', 'fix/mobile']) {
      assert.equal(mergeRefusal('develop', from, OK), null);
    }
    for (const from of ['main', 'develop']) {
      assert.match(mergeRefusal('develop', from, OK), /сливаются ветки задач/);
    }
  });

  /*
   * Согласие — то самое правило, которое я нарушил руками: работа уезжала в
   * develop, не показанная из своей ветки. Хук не знает, спрашивали ли, — зато
   * умеет не пускать, пока согласие не передано явно.
   */
  it('без согласия человека в общие ветки не пускает', () => {
    for (const [into, from] of [['develop', 'feature/pdf'], ['main', 'develop']]) {
      const refusal = mergeRefusal(into, from, '');
      assert.match(refusal, /не подтверждено/);
      assert.match(refusal, /APPROVED_BY/);
      // пробелы согласием не считаются
      assert.match(mergeRefusal(into, from, '   '), /не подтверждено/);
      assert.equal(mergeRefusal(into, from, OK), null);
    }
  });

  it('фича-ветки между собой не ограничивает и согласия не требует', () => {
    assert.equal(mergeRefusal('feature/a', 'feature/b'), null);
    assert.equal(mergeRefusal('feature/a', 'develop'), null);
  });

  it('прямой коммит в main и develop запрещает, в ветку задачи — нет', () => {
    assert.match(commitRefusal('main'), /Прямой коммит в main запрещён/);
    assert.match(commitRefusal('develop'), /Прямой коммит в develop запрещён/);
    assert.equal(commitRefusal('feature/pdf'), null);
    assert.equal(commitRefusal('fix/mobile'), null);
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
