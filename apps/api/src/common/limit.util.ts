/**
 * Ограничитель параллельности.
 *
 * Выгрузка четырёхлетнего аккаунта — это тысячи запросов, и пускать их все
 * разом нельзя: YAZIO ответит 429, а Node упрётся в лимит сокетов. Готовую
 * библиотеку тянуть незачем — здесь двадцать строк.
 */
export function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (concurrency < 1) throw new Error('Лимит параллельности должно быть не меньше 1');

  let active = 0;
  const queue: Array<() => void> = [];

  const release = (): void => {
    active--;
    queue.shift()?.();
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Прогоняет задачи с ограничением параллельности, сохраняя порядок
 * результатов. `onSettled` зовётся по мере готовности — на нём держится
 * прогресс синхронизации.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (done: number, total: number) => void | Promise<void>,
): Promise<R[]> {
  const limit = createLimiter(concurrency);
  let done = 0;
  return Promise.all(
    items.map((item, index) =>
      limit(async () => {
        try {
          return await worker(item, index);
        } finally {
          done++;
          // ждём: обработчик пишет прогресс в базу, а незавершённый сброс
          // пересчитывает снимки сущностей и съедает соседние изменения
          await onSettled?.(done, items.length);
        }
      }),
    ),
  );
}
