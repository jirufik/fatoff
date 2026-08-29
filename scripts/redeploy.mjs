#!/usr/bin/env node
/**
 * Пересборка контура после слияния.
 *
 * Слияние в `main` — это выкатка прода, слияние в `develop` — обновление
 * окружения проверки. Раньше это были два шага, и второй забывался: код в
 * ветке новый, а в докере крутится вчерашний образ. Теперь второй шаг делает
 * хук `post-merge`.
 *
 * Фича-ветки в докер не уезжают: слияние в них ничего не пересобирает.
 *
 * Пропустить пересборку (например, когда сливают несколько веток подряд):
 *   FATOFF_NO_REDEPLOY=1 git merge --no-ff feature/…
 */
import { execFileSync, spawnSync } from 'node:child_process';

import { environmentOf } from './branch-rules.mjs';

const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD']).toString().trim();
const environment = environmentOf(branch);

if (!environment) process.exit(0);

if (process.env.FATOFF_NO_REDEPLOY) {
  console.log(`Пересборка контура «${environment.name}» пропущена: FATOFF_NO_REDEPLOY.`);
  process.exit(0);
}

console.log(`\nСлияние в ${branch}: пересобираю контур «${environment.name}» на порту ${environment.port}.\n`);

for (const [command, ...args] of environment.commands) {
  const run = spawnSync(command, args, { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(
      `\nПересборка не удалась на «${command} ${args.join(' ')}».\n` +
        `Слияние при этом уже записано — контур остался на прежнем образе.\n` +
        `Починить и повторить: ${environment.commands.map((c) => c.join(' ')).join(' && ')}\n`,
    );
    process.exit(run.status ?? 1);
  }
}

console.log(`\nКонтур «${environment.name}» пересобран и запущен: http://localhost:${environment.port}\n`);
