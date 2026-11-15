import { MikroORM, ReflectMetadataProvider } from '@mikro-orm/postgresql';

import {
  Account,
  AccountSnapshot,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  DriveFetch,
  ExportFile,
  HealthDaily,
  HealthImport,
  HealthPoint,
  HealthSleep,
  HealthWorkout,
  MealPlan,
  PlanTemplate,
  ProductCache,
  RecipeCache,
  SyncRun,
  SyncWarning,
} from '../src/database/entities';

/**
 * Отдельная база на каждый файл тестов.
 *
 * Схема пересоздаётся перед файлом, поэтому состояние предсказуемо и не зависит
 * от порядка запуска, а разные файлы не мешают друг другу при параллельном
 * прогоне.
 */
export async function createTestOrm(suite: string): Promise<MikroORM> {
  const orm = await MikroORM.init({
    entities: [
      Account,
      AccountSnapshot,
      DaySnapshot,
      DriveFetch,
      ProductCache,
      RecipeCache,
      DailyNutrients,
      DailyExercise,
      BodyValue,
      SyncRun,
      SyncWarning,
      ExportFile,
      HealthImport,
      HealthDaily,
      HealthWorkout,
      HealthSleep,
      HealthPoint,
      MealPlan,
      PlanTemplate,
    ],
    metadataProvider: ReflectMetadataProvider,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5483),
    dbName: `fatoff_test_${suite}`,
    user: process.env.DB_USER ?? 'fatoff',
    password: process.env.DB_PASSWORD ?? 'fatoff',
    debug: process.env.ORM_DEBUG === '1',
    forceUtcTimezone: true,
    connect: false,
  });

  await orm.schema.ensureDatabase();
  await orm.connect();
  await orm.schema.refreshDatabase();
  return orm;
}

/** Конфигурация для тестов: тот же интерфейс, что у AppConfigService. */
export function testConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    NODE_ENV: 'test',
    SECRETS_KEY: '11'.repeat(32),
    YAZIO_API_BASE: 'http://127.0.0.1:0',
    YAZIO_API_VERSION: 'v9',
    YAZIO_CLIENT_ID: 'test-client',
    YAZIO_CLIENT_SECRET: 'test-client-secret',
    YAZIO_CONCURRENCY: 4,
    YAZIO_RESYNC_DAYS: 0,
    YAZIO_TIMEOUT_MS: 5_000,
    EXPORT_DIR: '',
    EXPORT_RETENTION_DAYS: 30,
    // способы доступа к Drive: по умолчанию нет ни одного, тест задаёт нужный
    GOOGLE_API_KEY: '',
    GOOGLE_SERVICE_ACCOUNT_FILE: '',
    DRIVE_API_BASE: 'https://www.googleapis.com/drive/v3',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    set: (key: string, value: unknown) => {
      values[key] = value;
    },
    isProduction: false,
    isTest: true,
  };
}
