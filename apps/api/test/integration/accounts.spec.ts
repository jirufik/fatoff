import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import { Account, DaySnapshot, ExportFile, SyncRun } from '../../src/database/entities';
import { AccountsService } from '../../src/modules/accounts/accounts.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { FakeYazio } from '../fake-yazio';
import { buildSyntheticAccount } from '../fixtures/synthetic';
import { createTestOrm, testConfig } from '../orm-test';

describe('аккаунты: два способа входа', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let fake: FakeYazio;
  let accounts: AccountsService;
  let crypto: CryptoService;

  beforeAll(async () => {
    orm = await createTestOrm('accounts');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();

    fake = new FakeYazio(buildSyntheticAccount());
    const base = await fake.start();

    const cfg = testConfig({ YAZIO_API_BASE: base });
    crypto = new CryptoService(cfg as unknown as AppConfigService);
    const yazio = new YazioService(cfg as unknown as AppConfigService, crypto, em);
    accounts = new AccountsService(em, crypto, yazio);
  });

  afterEach(async () => {
    await fake.stop();
  });

  it('добавляет аккаунт по паролю и шифрует его в базе', async () => {
    const dto = await accounts.create({
      email: 'User@Example.com',
      password: 'секрет',
      label: 'основной',
    });

    expect(dto.email).toBe('user@example.com');
    expect(dto.authMethod).toBe('password');
    expect(dto.registrationDate).toBe('2026-08-01');

    const stored = await em.fork().findOneOrFail(Account, { id: dto.id });
    // в базе лежит шифротекст, а не пароль
    expect(stored.passwordEnc).not.toContain('секрет');
    expect(crypto.decrypt(stored.passwordEnc!)).toBe('секрет');
    expect(crypto.decrypt(stored.accessTokenEnc!)).toBe(fake.accessToken);
    expect(stored.profile).toMatchObject({ sex: 'male' });
  });

  it('не принимает неверный пароль', async () => {
    await expect(
      accounts.create({ email: 'user@example.com', password: 'не тот' }),
    ).rejects.toThrow(/не приняты/i);
    expect(await em.fork().count(Account)).toBe(0);
  });

  it('добавляет аккаунт по токену — для входа через Apple ID', async () => {
    const dto = await accounts.create({
      email: '',
      accessToken: fake.accessToken,
      refreshToken: fake.refreshToken,
      label: 'apple',
    });

    // почту сервис берёт из профиля: человек может её и не знать
    expect(dto.email).toBe('user@example.com');
    expect(dto.authMethod).toBe('token');

    const stored = await em.fork().findOneOrFail(Account, { id: dto.id });
    expect(stored.passwordEnc).toBeNull();
    expect(crypto.decrypt(stored.refreshTokenEnc!)).toBe(fake.refreshToken);
  });

  it('не принимает недействительный токен', async () => {
    await expect(accounts.create({ email: '', accessToken: 'garbage-but-long-enough' })).rejects.toThrow();
    expect(await em.fork().count(Account)).toBe(0);
  });

  it('требует хоть чего-то для входа', async () => {
    await expect(accounts.create({ email: 'user@example.com' })).rejects.toThrow(
      /ни пароль, ни токен/,
    );
  });

  it('не заводит второй аккаунт на ту же почту', async () => {
    await accounts.create({ email: 'user@example.com', password: 'секрет' });
    await expect(
      accounts.create({ email: 'user@example.com', password: 'секрет' }),
    ).rejects.toThrow(/уже добавлен/);
  });

  it('обновляет токен у аккаунта без пароля', async () => {
    const dto = await accounts.create({ email: '', accessToken: fake.accessToken });

    fake.accessToken = 'fresh-access-token';
    const updated = await accounts.update(dto.id, {
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
    });

    expect(updated.authMethod).toBe('token');
    const stored = await em.fork().findOneOrFail(Account, { id: dto.id });
    expect(crypto.decrypt(stored.accessTokenEnc!)).toBe('fresh-access-token');
    expect(crypto.decrypt(stored.refreshTokenEnc!)).toBe('fresh-refresh-token');
  });

  it('не сохраняет неработающий пароль', async () => {
    const dto = await accounts.create({ email: 'user@example.com', password: 'секрет' });
    await expect(accounts.update(dto.id, { password: 'неверный' })).rejects.toThrow();

    const stored = await em.fork().findOneOrFail(Account, { id: dto.id });
    expect(crypto.decrypt(stored.passwordEnc!)).toBe('секрет');
  });

  it('меняет метку и выключает автосинхронизацию', async () => {
    const dto = await accounts.create({ email: 'user@example.com', password: 'секрет' });
    const updated = await accounts.update(dto.id, { label: 'второй', syncEnabled: false });

    expect(updated.label).toBe('второй');
    expect(updated.syncEnabled).toBe(false);
  });

  it('показывает, сколько дней аккаунта лежит в базе', async () => {
    const dto = await accounts.create({ email: 'user@example.com', password: 'секрет' });
    const account = await em.findOneOrFail(Account, { id: dto.id });

    for (const date of ['2026-08-01', '2026-08-02', '2026-08-05']) {
      em.create(DaySnapshot, {
        account,
        date,
        consumed: {},
        exercises: null,
        water: null,
        goals: null,
        goalsUnmodified: null,
        feeling: null,
        fetchedAt: new Date(),
      });
    }
    await em.flush();

    const detail = await accounts.detail(dto.id);
    expect(detail.storedDays).toBe(3);
    expect(detail.storedFrom).toBe('2026-08-01');
    expect(detail.storedTo).toBe('2026-08-05');
  });

  it('удаление уносит все данные аккаунта', async () => {
    const dto = await accounts.create({ email: 'user@example.com', password: 'секрет' });
    const account = await em.findOneOrFail(Account, { id: dto.id });

    em.create(DaySnapshot, {
      account,
      date: '2026-08-01',
      consumed: {},
      exercises: null,
      water: null,
      goals: null,
      goalsUnmodified: null,
      feeling: null,
      fetchedAt: new Date(),
    });
    em.create(SyncRun, {
      account,
      mode: 'incremental',
      status: 'done',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-01',
      datasets: [],
      allDays: false,
      force: false,
      daysTotal: 1,
      daysDone: 1,
      requests: 1,
      warningsCount: 0,
      cancelRequested: false,
      createdAt: new Date(),
    });
    em.create(ExportFile, {
      account,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-01',
      datasets: [],
      formats: ['json'],
      granularity: 'auto',
      redact: false,
      includeHealth: false,
      status: 'done',
      tables: [],
      createdAt: new Date(),
    });
    await em.flush();

    await accounts.remove(dto.id);

    const check = em.fork();
    expect(await check.count(Account)).toBe(0);
    expect(await check.count(DaySnapshot)).toBe(0);
    expect(await check.count(SyncRun)).toBe(0);
    expect(await check.count(ExportFile)).toBe(0);
  });
});
