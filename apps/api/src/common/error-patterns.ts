import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';

/**
 * Разделение ответственности, как в dynamic-competitor:
 * процессы бросают доменные ошибки обычным `Error`, а перевод в HTTP-статус
 * живёт в контроллере. Благодаря этому бизнес-логика не знает про транспорт
 * и одинаково работает из HTTP, из фоновой задачи и из теста.
 */

export interface ErrorPattern {
  /** подстрока в сообщении ошибки, регистр не важен */
  pattern: string;
  status: HttpStatus;
}

export const DEFAULT_ERROR_PATTERNS: ErrorPattern[] = [
  { pattern: 'не найден', status: HttpStatus.NOT_FOUND },
  { pattern: 'не найдена', status: HttpStatus.NOT_FOUND },
  { pattern: 'не найдено', status: HttpStatus.NOT_FOUND },
  { pattern: 'уже существует', status: HttpStatus.CONFLICT },
  { pattern: 'уже добавлен', status: HttpStatus.CONFLICT },
  { pattern: 'уже идёт', status: HttpStatus.CONFLICT },
  { pattern: 'не приняты', status: HttpStatus.UNAUTHORIZED },
  { pattern: 'не настроен', status: HttpStatus.BAD_REQUEST },
  { pattern: 'не выбран', status: HttpStatus.BAD_REQUEST },
  { pattern: 'не передан', status: HttpStatus.BAD_REQUEST },
  { pattern: 'нельзя', status: HttpStatus.BAD_REQUEST },
  { pattern: 'некорректн', status: HttpStatus.BAD_REQUEST },
  { pattern: 'неподдерживаемый', status: HttpStatus.BAD_REQUEST },
  { pattern: 'должно быть', status: HttpStatus.BAD_REQUEST },
  { pattern: 'позже конца', status: HttpStatus.BAD_REQUEST },
  { pattern: 'период пуст', status: HttpStatus.BAD_REQUEST },
];

/**
 * Переводит доменную ошибку в HTTP-исключение. Всегда бросает — тип `never`
 * позволяет вызывать её в конце catch-блока без лишнего `throw`.
 */
export function processHttpError(
  error: unknown,
  patterns: ErrorPattern[] = DEFAULT_ERROR_PATTERNS,
): never {
  // исключения, уже пришедшие из Nest (валидация DTO, guard), пропускаем как есть
  if (error instanceof HttpException) throw error;

  const message = error instanceof Error ? error.message : String(error);

  // ошибка, которая сама знает свой статус, надёжнее совпадения по тексту:
  // сообщение переформулируют, и подстрока перестаёт ловиться молча
  const declared = (error as { httpStatus?: unknown }).httpStatus;
  if (typeof declared === 'number') throw new HttpException(message, declared);

  const lower = message.toLowerCase();

  const matched = patterns.find((p) => lower.includes(p.pattern.toLowerCase()));
  if (matched) throw new HttpException(message, matched.status);

  throw new InternalServerErrorException(message);
}
