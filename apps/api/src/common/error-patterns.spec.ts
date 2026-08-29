import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { processHttpError } from './error-patterns';

/** Ловит статус, с которым ошибка ушла бы наружу. */
const statusOf = (error: unknown): number => {
  try {
    processHttpError(error);
  } catch (thrown) {
    return (thrown as HttpException).getStatus();
  }
  throw new Error('processHttpError обязана бросать');
};

describe('перевод доменной ошибки в HTTP', () => {
  it('пропускает исключения Nest как есть', () => {
    const original = new HttpException('уже готово', HttpStatus.FORBIDDEN);
    expect(statusOf(original)).toBe(403);
  });

  it('верит статусу, который ошибка объявила сама', () => {
    // так отвечает YazioAuthError: отказ на входе — это 401, а не наша поломка
    expect(statusOf(Object.assign(new Error('токен не принимается'), { httpStatus: 401 }))).toBe(401);
  });

  it('разбирает знакомые формулировки', () => {
    expect(statusOf(new Error('Аккаунт abc не найден'))).toBe(404);
    expect(statusOf(new Error('Аккаунт уже добавлен'))).toBe(409);
    expect(statusOf(new Error('Начало периода позже конца'))).toBe(400);
  });

  it('всё незнакомое считает своей поломкой', () => {
    expect(statusOf(new Error('нечто неожиданное'))).toBe(500);
  });
});
