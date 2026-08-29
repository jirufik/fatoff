import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { AccountDto } from '@fatoff/contracts';

import { CryptoService } from '../../common/crypto.service';
import { dayOf } from '../../common/date.util';
import { Account } from '../../database/entities';
import type { YazioTokens } from '../yazio/yazio-client';
import { YazioService } from '../yazio/yazio.service';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';

interface StoredRange {
  days: number;
  from: string | null;
  to: string | null;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly em: EntityManager,
    private readonly crypto: CryptoService,
    private readonly yazio: YazioService,
  ) {}

  async list(): Promise<AccountDto[]> {
    const accounts = await this.em.find(Account, {}, { orderBy: { createdAt: 'asc' } });
    const ranges = await this.storedRanges();
    return accounts.map((account) => this.toDto(account, ranges.get(account.id)));
  }

  async findOne(id: string): Promise<Account> {
    const account = await this.em.findOne(Account, { id });
    if (!account) throw new Error(`Аккаунт ${id} не найден`);
    return account;
  }

  async detail(id: string): Promise<AccountDto> {
    const account = await this.findOne(id);
    const ranges = await this.storedRanges(id);
    return this.toDto(account, ranges.get(id));
  }

  /**
   * Добавление аккаунта сразу проверяет вход: аккаунт, в который нельзя войти,
   * бесполезен, и узнавать об этом лучше здесь, а не ночью на автосинхронизации.
   *
   * Два пути: обычная пара почта/пароль и готовый токен — для аккаунтов, у
   * которых пароля не существует (вход через Apple ID, D-017).
   */
  async create(dto: CreateAccountDto): Promise<AccountDto> {
    if (!dto.password && !dto.accessToken) {
      throw new Error('Не передан ни пароль, ни токен доступа');
    }

    const { user, tokens } = dto.password
      ? await this.yazio.verifyCredentials(dto.email.trim().toLowerCase(), dto.password)
      : await this.yazio.verifyToken(dto.accessToken!, dto.refreshToken);

    // при входе по токену почта берётся из профиля: человек её мог и не знать,
    // если Apple подставил скрывающий адрес
    const email = (user.email ?? dto.email ?? '').trim().toLowerCase();
    if (!email) throw new Error('YAZIO не сообщил почту аккаунта, а без неё аккаунты не различить');

    const existing = await this.em.findOne(Account, { email });
    if (existing) throw new Error(`Аккаунт ${email} уже добавлен`);

    const account = this.em.create(Account, {
      email,
      label: dto.label?.trim() || null,
      passwordEnc: dto.password ? this.crypto.encrypt(dto.password) : null,
      accessTokenEnc: tokens.accessToken ? this.crypto.encrypt(tokens.accessToken) : null,
      refreshTokenEnc: tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt,
      registrationDate: user.registration_date ? dayOf(user.registration_date) : null,
      profile: user as unknown as Record<string, unknown>,
      syncEnabled: true,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.em.persistAndFlush(account);
    return this.toDto(account, undefined);
  }

  async update(id: string, dto: UpdateAccountDto): Promise<AccountDto> {
    const account = await this.findOne(id);

    if (dto.label !== undefined) account.label = dto.label?.trim() || null;
    if (dto.syncEnabled !== undefined) account.syncEnabled = dto.syncEnabled;

    // и пароль, и токен проверяются до записи: иначе можно сохранить неработающий
    if (dto.password) {
      const { tokens } = await this.yazio.verifyCredentials(account.email, dto.password);
      account.passwordEnc = this.crypto.encrypt(dto.password);
      this.storeTokens(account, tokens);
    } else if (dto.accessToken) {
      const { tokens } = await this.yazio.verifyToken(dto.accessToken, dto.refreshToken);
      this.storeTokens(account, tokens);
      account.lastSyncStatus = account.lastSyncStatus === 'failed' ? 'never' : account.lastSyncStatus;
    }

    await this.em.flush();
    const ranges = await this.storedRanges(id);
    return this.toDto(account, ranges.get(id));
  }

  /** Удаление уносит всё, что выгружено по аккаунту: у связей deleteRule cascade. */
  async remove(id: string): Promise<void> {
    const account = await this.findOne(id);
    await this.em.removeAndFlush(account);
  }

  /** Сколько дней аккаунта лежит в базе и за какой период. */
  private async storedRanges(accountId?: string): Promise<Map<string, StoredRange>> {
    const rows = await this.em.getConnection().execute<
      Array<{ account_id: string; days: number; date_from: string | null; date_to: string | null }>
    >(
      `select account_id,
              count(*)::int as days,
              min(date) as date_from,
              max(date) as date_to
         from day_snapshot
        ${accountId ? 'where account_id = ?' : ''}
        group by account_id`,
      accountId ? [accountId] : [],
    );

    return new Map(
      rows.map((row) => [
        row.account_id,
        { days: Number(row.days), from: row.date_from, to: row.date_to },
      ]),
    );
  }

  private storeTokens(account: Account, tokens: YazioTokens): void {
    account.accessTokenEnc = tokens.accessToken ? this.crypto.encrypt(tokens.accessToken) : null;
    account.refreshTokenEnc = tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null;
    account.tokenExpiresAt = tokens.expiresAt;
  }

  private toDto(account: Account, stored: StoredRange | undefined): AccountDto {
    return {
      id: account.id,
      email: account.email,
      label: account.label,
      authMethod: account.passwordEnc ? 'password' : 'token',
      registrationDate: account.registrationDate,
      syncEnabled: account.syncEnabled,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: account.lastSyncStatus,
      storedDays: stored?.days ?? 0,
      storedFrom: stored?.from ?? null,
      storedTo: stored?.to ?? null,
      createdAt: account.createdAt.toISOString(),
    };
  }
}
