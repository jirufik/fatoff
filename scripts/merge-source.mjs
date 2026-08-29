import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Откуда сливают — и идёт ли слияние вообще.
 *
 * Разведано опытом, а не по документации: в хуке `pre-merge-commit` git не
 * оставляет ни `MERGE_HEAD`, ни `MERGE_MSG` — автоматическое слияние
 * записывает коммит напрямую. Зато он выставляет `GIT_REFLOG_ACTION` вида
 * `merge feature/…`, и это самый надёжный источник имени.
 *
 * Файлы `MERGE_HEAD` и `MERGE_MSG` появляются в другом случае: слияние с
 * конфликтами. Тогда `pre-merge-commit` не зовётся вовсе, а завершающий
 * `git commit` идёт через обычный `pre-commit` — и вот там эти файлы есть.
 * Поэтому проверяются оба пути.
 */
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

/** Идёт ли слияние с конфликтами, которое завершают обычным коммитом. */
export function mergeInProgress() {
  try {
    return existsSync(`${git('rev-parse', '--git-dir')}/MERGE_HEAD`);
  } catch {
    return false;
  }
}

export function currentBranch() {
  try {
    return git('symbolic-ref', '--short', 'HEAD');
  } catch {
    return '(отсоединённая голова)';
  }
}

export function mergeSource() {
  const action = process.env.GIT_REFLOG_ACTION ?? '';
  const fromReflog = action.match(/^merge\s+(\S+)/);
  if (fromReflog) return fromReflog[1].replace(/^origin\//, '');

  try {
    const branches = git('branch', '--points-at', 'MERGE_HEAD', '--format=%(refname:short)')
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name && name !== currentBranch());
    if (branches.length > 0) return branches[0];
  } catch {
    // ветки может не быть — идём дальше
  }

  try {
    const path = `${git('rev-parse', '--git-dir')}/MERGE_MSG`;
    if (existsSync(path)) {
      const named = readFileSync(path, 'utf8')
        .split('\n')[0]
        .match(/^Merge (?:remote-tracking )?branch '([^']+)'/);
      if (named) return named[1].replace(/^origin\//, '');
    }
  } catch {
    // сообщения может не быть
  }

  try {
    return git('rev-parse', '--short', 'MERGE_HEAD');
  } catch {
    return '(неизвестно)';
  }
}
