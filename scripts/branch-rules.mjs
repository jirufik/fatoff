/**
 * Правила веток: что во что можно сливать и что после этого пересобирается.
 *
 * Вынесено отдельным файлом, потому что это единственное место, где правило
 * записано; хуки его только зовут. Заодно правило становится проверяемым:
 * у него есть тесты, а не «кажется, работает».
 */

/** Ветка прода. Всё, что в ней, — запущено и работает. */
export const MAIN = 'main';

/** Ветка общей проверки. Через неё проходит всё, что попадает в прод. */
export const DEVELOP = 'develop';

/**
 * Можно ли слить `from` в `into`.
 *
 * Возвращает `null`, когда можно, и объяснение, когда нельзя. Объяснение —
 * человеку у терминала, поэтому оно длиннее кода правила.
 */
export function mergeRefusal(into, from) {
  if (into === MAIN && from !== DEVELOP) {
    return (
      `В ${MAIN} сливается только ${DEVELOP}, а не «${from}».\n` +
      `${MAIN} — это то, что запущено и чем пользуются; всё попадает туда одним путём,\n` +
      `через общую проверку на ${DEVELOP}. Сделайте так:\n\n` +
      `  git switch ${DEVELOP} && git merge --no-ff ${from}\n` +
      `  # проверка на окружении develop\n` +
      `  git switch ${MAIN} && git merge --no-ff ${DEVELOP}\n`
    );
  }
  return null;
}

/**
 * Можно ли коммитить прямо в эту ветку.
 *
 * В `main` — нельзя: раз туда попадает только слияние `develop`, то и обычный
 * коммит туда попасть не должен, иначе правило обходится молча.
 */
export function commitRefusal(branch) {
  if (branch === MAIN) {
    return (
      `Прямой коммит в ${MAIN} запрещён.\n` +
      `${MAIN} собирается только слиянием ${DEVELOP}. Начните с ветки задачи:\n\n` +
      `  git switch ${DEVELOP}\n` +
      `  git switch -c feature/<что-делаем>\n`
    );
  }
  return null;
}

/**
 * Какой контур пересобирать после слияния в эту ветку.
 *
 * Фича-ветки в докер не уезжают вовсе — для них `null`.
 */
export function environmentOf(branch) {
  if (branch === MAIN) {
    return { name: 'прод', port: 4090, commands: [['pnpm', 'db:up'], ['pnpm', 'docker:up']] };
  }
  if (branch === DEVELOP) {
    return { name: 'develop', port: 4092, commands: [['pnpm', 'develop:up']] };
  }
  return null;
}
