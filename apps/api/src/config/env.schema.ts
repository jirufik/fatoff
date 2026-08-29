import { z } from 'zod';

const bool = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .pipe(z.boolean());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4090),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // доступ в сервис
  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD обязателен'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET должен быть не короче 16 символов'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default('false'),

  /** 32 байта в hex: ключ шифрования учётных данных YAZIO (D-004). */
  SECRETS_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_KEY — ровно 64 hex-символа (openssl rand -hex 32)'),

  // база
  DB_HOST: z.string().default('localhost'),
  // по умолчанию — база develop: клон без `.env` не должен целиться в прод
  DB_PORT: z.coerce.number().int().positive().default(5483),
  DB_NAME: z.string().default('fatoff'),
  DB_USER: z.string().default('fatoff'),
  DB_PASSWORD: z.string().default('fatoff'),
  DB_DEBUG: bool.default('false'),
  /** прогонять миграции при старте — нужно в контейнере, где нет CLI */
  DB_AUTO_MIGRATE: bool.default('true'),

  // API YAZIO
  YAZIO_API_BASE: z.string().url().default('https://yzapi.yazio.com'),
  YAZIO_API_VERSION: z.string().min(2).default('v9'),
  YAZIO_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(6),
  /** хвост дней, который перекачивается всегда: сегодняшний день ещё меняется */
  YAZIO_RESYNC_DAYS: z.coerce.number().int().min(0).max(90).default(3),
  YAZIO_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /** каталог с выгрузками Apple Health; монтируется в контейнер только на чтение */
  HEALTH_DIR: z.string().default('../../apple-health'),

  // выгрузки
  EXPORT_DIR: z.string().default('../../storage/exports'),
  EXPORT_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),

  /** cron ночной автосинхронизации; пустая строка — выключено */
  SYNC_CRON: z.string().default('0 3 * * *'),

  /**
   * Ключ Google API для чтения публичной папки Drive.
   *
   * Пустой — модуль загрузки из Drive не работает и честно об этом говорит.
   * OAuth не нужен: папка открыта по ссылке, ключ лишь позволяет её перечислить.
   */
  GOOGLE_API_KEY: z.string().default(''),

  /** Адрес Drive API; меняется только в тестах, где поднимается подставной. */
  DRIVE_API_BASE: z.string().default('https://www.googleapis.com/drive/v3'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация окружения:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
