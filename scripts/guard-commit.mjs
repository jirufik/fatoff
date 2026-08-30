#!/usr/bin/env node
/**
 * Проверка ветки перед коммитом.
 *
 * Два разных случая под одним хуком. Обычный коммит в `main` запрещён: раз
 * туда попадает только слияние `develop`, то и коммит туда попасть не должен,
 * иначе правило обходится молча и без злого умысла.
 *
 * Второй случай — слияние с конфликтами. При нём `pre-merge-commit` не
 * зовётся вовсе, а завершающий `git commit` идёт сюда. Отказать ему как
 * «прямому коммиту в main» было бы неверно: это законное слияние develop.
 * Поэтому при незавершённом слиянии проверяется правило слияния.
 */
import { APPROVAL_VAR, commitRefusal, mergeRefusal } from './branch-rules.mjs';
import { currentBranch, mergeInProgress, mergeSource } from './merge-source.mjs';

const branch = currentBranch();
const refusal = mergeInProgress()
  ? mergeRefusal(branch, mergeSource(), process.env[APPROVAL_VAR] ?? '')
  : commitRefusal(branch);

if (refusal) {
  console.error(`\nКоммит остановлен.\n\n${refusal}`);
  process.exit(1);
}
