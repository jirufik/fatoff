import { describe, expect, it } from 'vitest';

import { planDays, resolveDatasets, type PlanInput, type StoredDay } from './sync-plan';

const totals = (date: string, energy: number): StoredDay => ({
  date,
  energy,
  carb: 10,
  protein: 10,
  fat: 10,
  energyGoal: 2000,
  hasSnapshot: true,
});

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  from: '2026-08-01',
  to: '2026-08-10',
  remote: [],
  stored: [],
  today: '2026-08-10',
  resyncDays: 0,
  allDays: false,
  force: false,
  ...over,
});

describe('план синхронизации', () => {
  it('первый запуск берёт все дни, о которых сообщил YAZIO', () => {
    const plan = planDays(base({ remote: [totals('2026-08-01', 1800), totals('2026-08-03', 2100)] }));
    expect(plan).toEqual([
      { date: '2026-08-01', reason: 'new' },
      { date: '2026-08-03', reason: 'new' },
    ]);
  });

  it('повторный запуск не берёт ничего, если итоги совпали', () => {
    const day = totals('2026-08-01', 1800);
    expect(planDays(base({ remote: [day], stored: [day] }))).toEqual([]);
  });

  it('берёт день, у которого изменились итоги', () => {
    const plan = planDays(
      base({ remote: [totals('2026-08-01', 1950)], stored: [totals('2026-08-01', 1800)] }),
    );
    expect(plan).toEqual([{ date: '2026-08-01', reason: 'changed' }]);
  });

  it('не считает изменением дребезг плавающей точки', () => {
    const stored = totals('2026-08-01', 1800);
    const remote = { ...stored, energy: 1800.004 };
    expect(planDays(base({ remote: [remote], stored: [stored] }))).toEqual([]);
  });

  it('берёт день, у которого есть итоги, но нет сырого снимка', () => {
    const stored = { ...totals('2026-08-01', 1800), hasSnapshot: false };
    const plan = planDays(base({ remote: [totals('2026-08-01', 1800)], stored: [stored] }));
    expect(plan).toEqual([{ date: '2026-08-01', reason: 'new' }]);
  });

  it('всегда перепроверяет хвост последних дней', () => {
    const stored = ['2026-08-08', '2026-08-09', '2026-08-10'].map((d) => totals(d, 1800));
    const plan = planDays(base({ remote: stored, stored, resyncDays: 3 }));
    expect(plan.map((p) => p.date)).toEqual(['2026-08-08', '2026-08-09', '2026-08-10']);
    expect(plan.every((p) => p.reason === 'recent')).toBe(true);
  });

  it('хвост перепроверки попадает в план, даже если YAZIO о дне молчит', () => {
    // сегодня еда ещё не записана, но цели и вода за день уже могут быть
    const plan = planDays(base({ resyncDays: 1 }));
    expect(plan).toEqual([{ date: '2026-08-10', reason: 'new' }]);
  });

  it('хвост не выходит за границы периода', () => {
    // выгружаем прошлый год — перепроверять в нём нечего
    const plan = planDays(base({ from: '2025-01-01', to: '2025-01-03', resyncDays: 3 }));
    expect(plan).toEqual([]);
  });

  it('режим «все дни» проходит каждую дату периода', () => {
    const plan = planDays(base({ from: '2026-08-01', to: '2026-08-04', allDays: true }));
    expect(plan.map((p) => p.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('принудительный режим берёт всё, даже совпавшее', () => {
    const day = totals('2026-08-01', 1800);
    const plan = planDays(base({ remote: [day], stored: [day], force: true }));
    expect(plan).toEqual([{ date: '2026-08-01', reason: 'forced' }]);
  });

  it('отбрасывает дни вне запрошенного периода', () => {
    const plan = planDays(
      base({
        from: '2026-08-05',
        to: '2026-08-06',
        remote: [totals('2026-08-01', 1800), totals('2026-08-05', 1800)],
      }),
    );
    expect(plan.map((p) => p.date)).toEqual(['2026-08-05']);
  });
});

describe('выбор датасетов', () => {
  it('пустой выбор означает всё', () => {
    expect(resolveDatasets()).toHaveLength(12);
    expect(resolveDatasets([])).toHaveLength(12);
  });

  it('подтягивает дневник к продуктам и рецептам', () => {
    expect(resolveDatasets(['products'])).toEqual(['diary', 'products']);
    expect(resolveDatasets(['recipes'])).toEqual(['diary', 'recipes']);
  });

  it('оставляет выбор без зависимостей как есть', () => {
    expect(resolveDatasets(['weight'])).toEqual(['weight']);
  });

  it('возвращает датасеты в каноническом порядке', () => {
    expect(resolveDatasets(['weight', 'diary', 'account'])).toEqual(['diary', 'weight', 'account']);
  });
});
