import type { IsoDate } from './common.js';

export type AccountSyncStatus = 'never' | 'ok' | 'failed' | 'running';

/**
 * Чем сервис входит в аккаунт.
 *
 * `password` — обычная пара почта/пароль: сервис может войти заново когда угодно.
 * `token` — аккаунт, у которого пароля нет вовсе (вход через Apple ID): сервис
 * живёт на выданном токене и обновляет его, пока YAZIO этот токен не отзовёт.
 */
export type AuthMethod = 'password' | 'token';

export interface AccountDto {
  id: string;
  email: string;
  /** Человеческая метка: «основной», «второй». Пустая — показываем email. */
  label: string | null;
  authMethod: AuthMethod;
  /** Аккаунт с выдуманной историей: синхронизировать нечего (D-068). */
  isDemo: boolean;
  registrationDate: IsoDate | null;
  syncEnabled: boolean;
  /** Время ежедневной синхронизации `ЧЧ:ММ`; пусто — по общему расписанию. */
  syncDailyAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: AccountSyncStatus;
  /** Сколько дней аккаунта лежит в базе и за какой период. */
  storedDays: number;
  storedFrom: IsoDate | null;
  storedTo: IsoDate | null;
  createdAt: string;
}

export interface CreateAccountRequest {
  email: string;
  label?: string;
  /** Обычный вход. Взаимоисключим с `accessToken`. */
  password?: string;
  /** Вход по готовому токену — для аккаунтов без пароля (Apple ID). */
  accessToken?: string;
  /** Без него сервис проживёт только до конца жизни access-токена (48 часов). */
  refreshToken?: string;
}

export interface UpdateAccountRequest {
  label?: string | null;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  syncEnabled?: boolean;
  syncDailyAt?: string | null;
}
