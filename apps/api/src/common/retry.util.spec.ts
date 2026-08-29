import { describe, expect, it, vi } from 'vitest';

import { isTransientError, retry } from './retry.util';

const noSleep = async (): Promise<void> => undefined;

describe('повторы', () => {
  it('возвращает результат первой удачной попытки', async () => {
    const operation = vi.fn().mockResolvedValue('готово');
    await expect(retry(operation, { sleep: noSleep })).resolves.toBe('готово');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('повторяет 429 и отдаёт результат', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('too many'), { status: 429 }))
      .mockResolvedValue('готово');

    await expect(retry(operation, { sleep: noSleep })).resolves.toBe('готово');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('не повторяет 401 и 404 — они не станут другими от повтора', async () => {
    for (const status of [401, 404]) {
      const operation = vi.fn().mockRejectedValue(Object.assign(new Error('нет'), { status }));
      await expect(retry(operation, { sleep: noSleep })).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it('исчерпывает попытки и бросает последнюю ошибку', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('лежит'), { status: 503 }));
    await expect(retry(operation, { attempts: 3, sleep: noSleep })).rejects.toThrow('лежит');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('подписывает ошибку меткой операции', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('нет прав'));
    await expect(retry(operation, { label: 'products', sleep: noSleep })).rejects.toThrow(
      'products: нет прав',
    );
  });

  it('узнаёт временные сбои', () => {
    expect(isTransientError(Object.assign(new Error(''), { status: 500 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error(''), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientError(new Error('fetch failed'))).toBe(true);
    expect(isTransientError(Object.assign(new Error(''), { status: 400 }))).toBe(false);
  });
});
