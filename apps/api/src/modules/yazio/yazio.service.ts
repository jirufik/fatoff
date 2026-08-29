import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { CryptoService } from '../../common/crypto.service';
import { AppConfigService } from '../../config/app-config.service';
import { Account } from '../../database/entities';
import { YazioClient, type YazioClientOptions, type YazioTokens } from './yazio-client';
import type { YazioUser } from './yazio.types';

/**
 * Фабрика клиентов YAZIO.
 *
 * Расшифровка учётных данных и сохранение обновлённых токенов живут здесь, а не
 * в самом клиенте: клиент ничего не знает ни про базу, ни про шифрование, и
 * потому тестируется без того и другого.
 */
@Injectable()
export class YazioService {
  constructor(
    private readonly cfg: AppConfigService,
    private readonly crypto: CryptoService,
    private readonly em: EntityManager,
  ) {}

  clientFor(account: Account): YazioClient {
    return new YazioClient({
      email: account.email,
      // у аккаунта через Apple ID пароля нет — клиент живёт на токене (D-017)
      password: account.passwordEnc ? this.crypto.decrypt(account.passwordEnc) : undefined,
      base: this.cfg.get('YAZIO_API_BASE'),
      version: this.cfg.get('YAZIO_API_VERSION'),
      timeoutMs: this.cfg.get('YAZIO_TIMEOUT_MS'),
      concurrency: this.cfg.get('YAZIO_CONCURRENCY'),
      tokens: {
        // ключ шифрования мог смениться — тогда просто войдём заново по паролю
        accessToken: this.crypto.tryDecrypt(account.accessTokenEnc),
        refreshToken: this.crypto.tryDecrypt(account.refreshTokenEnc),
        expiresAt: account.tokenExpiresAt,
      },
      onTokens: async (tokens) => {
        // отдельный EntityManager: колбэк срабатывает посреди долгой выгрузки,
        // и трогать её единицу работы записью токенов нельзя
        await this.em.fork().nativeUpdate(
          Account,
          { id: account.id },
          {
            accessTokenEnc: tokens.accessToken ? this.crypto.encrypt(tokens.accessToken) : null,
            refreshTokenEnc: tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null,
            tokenExpiresAt: tokens.expiresAt,
            updatedAt: new Date(),
          },
        );
      },
    });
  }

  /**
   * Проверка учётных данных при добавлении аккаунта: вход плюс профиль.
   * Профиль нужен сразу — в нём дата регистрации, то есть начало истории.
   */
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<{ user: YazioUser; tokens: YazioTokens }> {
    const client = this.probe({ email, password });
    await client.login();
    const user = await client.user();
    return { user, tokens: client.tokens };
  }

  /**
   * Проверка готового токена — для аккаунтов, у которых пароля нет (D-017).
   * Ответ `GET /user` заодно приносит почту и дату регистрации, так что
   * спрашивать их у человека не нужно.
   */
  async verifyToken(
    accessToken: string,
    refreshToken?: string,
  ): Promise<{ user: YazioUser; tokens: YazioTokens }> {
    const client = this.probe({
      email: '',
      tokens: { accessToken, refreshToken: refreshToken ?? null, expiresAt: null },
    });

    const user = await client.user();
    return { user, tokens: client.tokens };
  }

  private probe(options: Pick<YazioClientOptions, 'email' | 'password' | 'tokens'>): YazioClient {
    return new YazioClient({
      ...options,
      base: this.cfg.get('YAZIO_API_BASE'),
      version: this.cfg.get('YAZIO_API_VERSION'),
      timeoutMs: this.cfg.get('YAZIO_TIMEOUT_MS'),
      concurrency: 2,
    });
  }
}
