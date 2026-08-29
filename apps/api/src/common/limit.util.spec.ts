import { describe, expect, it } from 'vitest';

import { createLimiter, mapLimit } from './limit.util';

const defer = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('ограничитель параллельности', () => {
  it('не пускает больше указанного числа задач разом', async () => {
    let active = 0;
    let peak = 0;
    const limit = createLimiter(3);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await defer(5);
          active--;
        }),
      ),
    );

    expect(peak).toBe(3);
  });

  it('сохраняет порядок результатов независимо от порядка завершения', async () => {
    const items = [30, 5, 20, 1];
    const result = await mapLimit(items, 2, async (ms) => {
      await defer(ms);
      return ms;
    });
    expect(result).toEqual(items);
  });

  it('сообщает о прогрессе по мере готовности', async () => {
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4], 2, async () => undefined, (done) => {
      seen.push(done)
    });
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('освобождает место даже когда задача упала', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error('сбой'); })).rejects.toThrow('сбой');
    // если бы место не освободилось, следующая задача повисла бы навсегда
    await expect(limit(async () => 'жив')).resolves.toBe('жив');
  });

  it('требует осмысленного лимита', () => {
    expect(() => createLimiter(0)).toThrow(/не меньше 1/);
  });
});
