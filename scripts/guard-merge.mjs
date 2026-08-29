#!/usr/bin/env node
/**
 * Проверка слияния: во что и откуда.
 *
 * Зовётся хуком `pre-merge-commit` — после того, как git свёл файлы, но до
 * того, как появился коммит слияния.
 *
 * Ускоренное слияние (fast-forward) коммита не создаёт и хука не запускает,
 * поэтому в репозитории выключен `merge.ff`: слияние всегда делает коммит, и
 * правило всегда проверяется.
 */
import { mergeRefusal } from './branch-rules.mjs';
import { currentBranch, mergeSource } from './merge-source.mjs';

const into = currentBranch();
const from = mergeSource();
const refusal = mergeRefusal(into, from);

if (refusal) {
  console.error(`\nСлияние остановлено.\n\n${refusal}`);
  console.error('Свернуть незаконченное слияние: git merge --abort\n');
  process.exit(1);
}
