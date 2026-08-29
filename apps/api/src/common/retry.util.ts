/**
 * Повтор операции с экспоненциальной задержкой и полным джиттером.
 *
 * Джиттер здесь не украшение: без него параллельные повторы синхронизируются и
 * бьют по внешнему сервису одной волной ровно тогда, когда он и так нездоров.
 * А параллельных запросов к YAZIO при выгрузке истории — шесть штук постоянно.
 */

export interface RetryOptions {
  /** сколько всего попыток, включая первую */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** повторять ли эту ошибку; по умолчанию — только сетевые сбои, 429 и 5xx */
  isRetryable?: (error: unknown) => boolean;
  /** вызывается перед каждой паузой — для журнала */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** имя операции для сообщения об ошибке */
  label?: string;
  /** подмена паузы в тестах */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
} as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Коды сетевых сбоев, при которых повтор осмыслен. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** HTTP-статусы, при которых повтор осмыслен. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: number; response?: { status?: number } };
  return e?.status ?? e?.response?.status;
}

export function isTransientError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: string; cause?: { code?: unknown } };

  if (typeof e?.code === 'string' && TRANSIENT_CODES.has(e.code)) return true;
  if (typeof e?.cause?.code === 'string' && TRANSIENT_CODES.has(e.cause.code as string)) return true;

  const status = statusOf(error);
  if (status !== undefined && TRANSIENT_STATUSES.has(status)) return true;

  // на случай, когда причина осталась только в тексте
  return /socket hang up|network|fetch failed|timeout|temporarily unavailable/i.test(
    e?.message ?? '',
  );
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const isRetryable = options.isRetryable ?? isTransientError;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const canRetry = attempt < attempts && isRetryable(error);
      if (!canRetry) break;

      // экспонента с полным джиттером: пауза равномерна на [0, cap]
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(Math.random() * cap);

      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  if (options.label && lastError instanceof Error) {
    lastError.message = `${options.label}: ${lastError.message}`;
  }
  throw lastError;
}
