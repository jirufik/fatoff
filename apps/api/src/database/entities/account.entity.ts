import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

import type { AccountSyncStatus } from '@fatoff/contracts';

/**
 * Аккаунт YAZIO, из которого выгружаются данные.
 *
 * Пароль и оба токена лежат шифрованными (D-004): ключ живёт в окружении, а не
 * в базе. Профиль сохраняется целиком — он нужен дайджесту (пол, возраст, рост)
 * и меняется достаточно редко, чтобы держать последнюю копию.
 */
@Entity({ tableName: 'account' })
export class Account {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @Property({ type: 'text', unique: true })
  email!: string;

  /** Человеческая метка: «основной», «второй». Пустая — показываем email. */
  @Property({ type: 'text', nullable: true })
  label: string | null = null;

  /**
   * Пароля может не быть вовсе: аккаунт, заведённый через Apple ID, живёт на
   * выданном токене (D-017).
   */
  @Property({ type: 'text', nullable: true })
  passwordEnc: string | null = null;

  @Property({ type: 'text', nullable: true })
  accessTokenEnc: string | null = null;

  @Property({ type: 'text', nullable: true })
  refreshTokenEnc: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null = null;

  /** `YYYY-MM-DD`, начало истории аккаунта. См. D-006. */
  @Property({ type: 'string', length: 10, nullable: true })
  registrationDate: string | null = null;

  /** Последний ответ `GET /user` целиком. */
  @Property({ type: 'json', nullable: true })
  profile: Record<string, unknown> | null = null;

  @Property({ type: 'boolean' })
  syncEnabled: boolean = true;

  @Property({ type: 'timestamptz', nullable: true })
  lastSyncAt: Date | null = null;

  @Property({ type: 'text' })
  lastSyncStatus: AccountSyncStatus = 'never';

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
