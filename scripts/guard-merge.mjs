#!/usr/bin/env node
/**
 * Проверка слияния: во что и откуда.
 *
 * Зовётся хуком `pre-merge-commit` — то есть после того, как git свёл файлы, но
 * до того, как появился коммит слияния. Отказ здесь оставляет рабочий каталог
 * в состоянии незавершённого слияния, поэтому в сообщении сразу сказано, чем
 * его свернуть.
 *
 * Ускоренное слияние (fast-forward) коммита не создаёт и хука не запускает —
 * поэтому в репозитории выключен `merge.ff`: слияние всегда делает коммит, и
 * правило всегда проверяется.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { mergeRefusal } from './branch-rules.mjs';

const git = (...args) => execFileSync('git', args).toString().trim();

/**
 * Откуда сливают.
 *
 * Сначала — имя ветки, на которую указывает `MERGE_HEAD`. Если ветки нет
 * (слили по хешу), берём формулировку из заготовленного сообщения слияния: там
 * git пишет, что именно сливается.
 */
function sourceOf() {
  try {
    const byBranch = git('branch', '--points-at', 'MERGE_HEAD', '--format=%(refname:short)')
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => name !== git('symbolic-ref', '--short', 'HEAD'));
    if (byBranch.length > 0) return byBranch[0];
  } catch {
    // ветки может не быть — идём дальше
  }

  const path = `${git('rev-parse', '--git-dir')}/MERGE_MSG`;
  if (existsSync(path)) {
    const first = readFileSync(path, 'utf8').split('\n')[0];
    const named = first.match(/^Merge (?:remote-tracking )?branch '([^']+)'/);
    if (named) return named[1].replace(/^origin\//, '');
  }

  try {
    return git('rev-parse', '--short', 'MERGE_HEAD');
  } catch {
    return '(неизвестно)';
  }
}

const into = git('symbolic-ref', '--short', 'HEAD');
const from = sourceOf();
const refusal = mergeRefusal(into, from);

if (refusal) {
  console.error(`\nСлияние остановлено.\n\n${refusal}`);
  console.error('Свернуть незаконченное слияние: git merge --abort\n');
  process.exit(1);
}
