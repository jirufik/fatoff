import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CryptoService } from '../../src/common/crypto.service';
import type { AppConfigService } from '../../src/config/app-config.service';
import { Account, SyncRun } from '../../src/database/entities';
import { AppleHealthQueryService } from '../../src/modules/apple-health/health-query.service';
import { BrowseService } from '../../src/modules/browse/browse.service';
import { SyncService } from '../../src/modules/sync/sync.service';
import { YazioService } from '../../src/modules/yazio/yazio.service';
import { FakeYazio } from '../fake-yazio';
import { buildSyntheticAccount } from '../fixtures/synthetic';
import { createTestOrm, testConfig } from '../orm-test';

const TODAY = '2026-08-10';

describe('просмотр выгруженного', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let fake: FakeYazio;
  let browse: BrowseService;
  let account: Account;

  beforeAll(async () => {
    orm = await createTestOrm('browse');
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();

    const data = buildSyntheticAccount();
    fake = new FakeYazio(data);
    const base = await fake.start();

    const cfg = testConfig({ YAZIO_API_BASE: base });
    const crypto = new CryptoService(cfg as unknown as AppConfigService);
    const yazio = new YazioService(cfg as unknown as AppConfigService, crypto, em);
    const sync = new SyncService(em, cfg as unknown as AppConfigService, yazio);
    browse = new BrowseService(em, new AppleHealthQueryService(em));

    account = em.create(Account, {
      email: data.email,
      label: 'тестовый',
      passwordEnc: crypto.encrypt(data.password),
      registrationDate: '2026-08-01',
      profile: null,
      isDemo: false,
      syncEnabled: true,
      driveEnabled: false,
      lastSyncStatus: 'never',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.persistAndFlush(account);

    const run = await sync.start(account.id, { to: TODAY });
    for (let i = 0; i < 400; i++) {
      const state = await em.fork().findOne(SyncRun, { id: run.id });
      if (state && ['done', 'failed', 'cancelled'].includes(state.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  afterEach(async () => {
    await fake.stop();
  });

  describe('дневник', () => {
    it('отдаёт страницу и общее число под фильтром', async () => {
      const first = await browse.diary(account.id, { pageSize: 5, page: 1 });
      expect(first.items).toHaveLength(5);
      expect(first.total).toBe(13);
      expect(first.page).toBe(1);

      const last = await browse.diary(account.id, { pageSize: 5, page: 3 });
      expect(last.items).toHaveLength(3);
      expect(last.total).toBe(13);
    });

    it('считает нутриенты по правилам каждого вида записи', async () => {
      const rows = await browse.diary(account.id, { from: '2026-08-01', to: '2026-08-01' });

      const apple = rows.items.find((row) => row.name === 'Яблоко')!;
      // 0.52 ккал на грамм × 150 г
      expect(apple.energyKcal).toBe(78);
      expect(apple.amount).toBe(150);
      expect(apple.kind).toBe('product');
    });

    it('рецепт умножается на порции, быстрая запись — ни на что', async () => {
      const recipes = await browse.diary(account.id, { kind: 'recipe_portion' });
      const soup = recipes.items.find((row) => row.name === 'Овощной суп')!;
      expect(soup.energyKcal).toBe(420); // 210 на порцию × 2

      const quick = await browse.diary(account.id, { kind: 'simple_product' });
      expect(quick.items).toHaveLength(1);
      expect(quick.items[0].energyKcal).toBe(640);
      expect(quick.items[0].amount).toBeNull();
    });

    it('не теряет запись, у которой не выгрузилась карточка продукта', async () => {
      const rows = await browse.diary(account.id, { search: 'Unknown' });
      expect(rows.total).toBe(1);
      expect(rows.items[0].energyKcal).toBeNull();
    });

    it('фильтрует по приёму пищи, периоду и названию', async () => {
      expect((await browse.diary(account.id, { meal: 'breakfast' })).total).toBe(5);
      expect((await browse.diary(account.id, { from: '2026-08-02', to: '2026-08-02' })).total).toBe(3);

      const found = await browse.diary(account.id, { search: 'хлеб' });
      expect(found.total).toBeGreaterThan(0);
      // поиск не должен зависеть от регистра
      expect(found.items.every((row) => row.name.toLowerCase().includes('хлеб'))).toBe(true);
    });

    it('сортирует по дате и по калориям', async () => {
      const newest = await browse.diary(account.id, { sort: 'date', dir: 'desc' });
      expect(newest.items[0].date).toBe('2026-08-10');

      const oldest = await browse.diary(account.id, { sort: 'date', dir: 'asc' });
      expect(oldest.items[0].date).toBe('2026-08-01');

      const heaviest = await browse.diary(account.id, { sort: 'energy', dir: 'desc' });
      expect(heaviest.items[0].energyKcal).toBe(640);
    });

    it('страницы не пересекаются и покрывают выдачу целиком', async () => {
      const seen = new Set<string>();
      for (let page = 1; page <= 3; page++) {
        const chunk = await browse.diary(account.id, { pageSize: 5, page });
        for (const row of chunk.items) seen.add(`${row.date} ${row.name} ${row.loggedAt}`);
      }
      expect(seen.size).toBe(13);
    });
  });

  describe('дни', () => {
    it('показывает день с итогами, водой и числом записей', async () => {
      const rows = await browse.days(account.id, { from: '2026-08-01', to: '2026-08-01' });
      expect(rows.total).toBe(1);

      const day = rows.items[0];
      expect(day.entries).toBe(2);
      expect(day.waterMl).toBe(1500);
      expect(day.energyGoalKcal).toBe(1900);
      expect(day.weightKg).toBe(75);
    });

    it('умеет прятать дни без еды', async () => {
      const all = await browse.days(account.id, {});
      const withFood = await browse.days(account.id, { withFood: true });
      expect(withFood.total).toBeLessThanOrEqual(all.total);
      expect(withFood.items.every((row) => row.entries > 0)).toBe(true);
    });
  });

  describe('продукты', () => {
    it('считает, сколько раз продукт встречается в дневнике', async () => {
      const rows = await browse.products(account.id, {});
      const apple = rows.items.find((row) => row.name === 'Яблоко')!;
      expect(apple.entries).toBe(4);
      expect(apple.energyPerUnit).toBe(0.52);
      expect(apple.lastUsed).toBe('2026-08-10');
    });

    it('ищет по названию', async () => {
      const rows = await browse.products(account.id, { search: 'масло' });
      expect(rows.total).toBe(1);
      expect(rows.items[0].name).toBe('Оливковое масло');
    });
  });

  describe('замеры', () => {
    it('отдаёт вес по убыванию времени', async () => {
      const rows = await browse.measurements(account.id, { kind: 'weight' });
      expect(rows.total).toBe(3);
      expect(rows.items[0].date).toBe('2026-08-10');
      expect(rows.items[0].value).toBe(73.8);
    });

    it('фильтрует по виду замера', async () => {
      expect((await browse.measurements(account.id, { kind: 'body_fat' })).total).toBe(1);
    });
  });
});
