#!/usr/bin/env node
/**
 * Проверка ветки перед обычным коммитом.
 *
 * В `main` попадает только слияние `develop` — значит, и прямой коммит туда
 * попасть не должен, иначе правило обходится молча и без злого умысла.
 *
 * Коммит слияния этот хук не трогает: у него свой, `pre-merge-commit`.
 */
import { execFileSync } from 'node:child_process';

import { commitRefusal } from './branch-rules.mjs';

const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD']).toString().trim();
const refusal = commitRefusal(branch);

if (refusal) {
  console.error(`\nКоммит остановлен.\n\n${refusal}`);
  process.exit(1);
}
