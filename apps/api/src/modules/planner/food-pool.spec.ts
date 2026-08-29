import { describe, expect, it } from 'vitest';

import { DEFAULT_ALGORITHM_SETTINGS } from '@fatoff/contracts';

import { buildPool, median, type PoolEntry } from './food-pool';

const TODAY = '2026-08-28';
const settings = DEFAULT_ALGORITHM_SETTINGS;

const entry = (over: Partial<PoolEntry> = {}): PoolEntry => ({
  key: 'product:oat',
  kind: 'product',
  sourceId: 'oat',
  name: 'Овсянка',
  producer: null,
  baseUnit: 'g',
  serving: 'gram',
  servingAmount: null,
  meal: 'breakfast',
  date: '2026-08-01',
  amount: 60,
  per: { energyKcal: 3.7, proteinG: 0.13, carbsG: 0.6, fatG: 0.07, fiberG: 0.1 },
  ...over,
});

describe('пул продуктов', () => {
  it('медиана порции не уезжает за одной большой записью', () => {
    expect(median([40, 50, 60])).toBe(50);
    expect(median([40, 50, 60, 400])).toBe(55);

    const pool = buildPool(
      [entry({ amount: 40 }), entry({ amount: 50 }), entry({ amount: 60 }), entry({ amount: 400 })],
      settings,
      TODAY,
    );
    expect(pool[0].typicalAmount).toBe(55);
  });

  it('границы порции считаются от привычной', () => {
    const [item] = buildPool([entry(), entry(), entry()], settings, TODAY);
    expect(item.typicalAmount).toBe(60);
    expect(item.minAmount).toBe(30); // ×0.5
    expect(item.maxAmount).toBe(96); // ×1.6
  });

  it('редкое в пул не идёт', () => {
    expect(buildPool([entry(), entry()], settings, TODAY)).toHaveLength(0);
    expect(buildPool([entry(), entry(), entry()], settings, TODAY)).toHaveLength(1);
  });

  it('давно забытое в пул не идёт', () => {
    const old = [1, 2, 3].map(() => entry({ date: '2024-01-15' }));
    expect(buildPool(old, settings, TODAY)).toHaveLength(0);

    // одной свежей записи хватает, чтобы продукт вернулся
    expect(buildPool([...old, entry({ date: '2026-08-01' })], settings, TODAY)).toHaveLength(1);
  });

  it('овсянка не поедет в ужин из-за одного случая', () => {
    const entries = [
      ...Array.from({ length: 10 }, () => entry({ meal: 'breakfast' })),
      entry({ meal: 'dinner' }),
    ];
    expect(buildPool(entries, settings, TODAY)[0].meals).toEqual(['breakfast']);
  });

  it('но продукт, который правда едят в двух приёмах, остаётся в обоих', () => {
    const entries = [
      ...Array.from({ length: 6 }, () => entry({ meal: 'lunch' })),
      ...Array.from({ length: 4 }, () => entry({ meal: 'dinner' })),
    ];
    expect(buildPool(entries, settings, TODAY)[0].meals).toEqual(['lunch', 'dinner']);
  });

  it('продукт без единого преобладающего приёма остаётся при самом частом', () => {
    const entries = [
      ...Array.from({ length: 3 }, (_, i) => entry({ meal: `meal-${i}` })),
      entry({ meal: 'meal-0' }),
      ...Array.from({ length: 20 }, (_, i) => entry({ meal: `rare-${i}` })),
    ];
    expect(buildPool(entries, settings, TODAY)[0].meals).toEqual(['meal-0']);
  });

  it('записи без количества и без энергии отбрасываются', () => {
    const broken = [entry({ amount: 0 }), entry({ amount: -5 }), entry({ per: { ...entry().per, energyKcal: 0 } })];
    expect(buildPool(broken, settings, TODAY)).toHaveLength(0);
  });

  it('самые частые продукты идут первыми', () => {
    const pool = buildPool(
      [
        ...Array.from({ length: 3 }, () => entry({ key: 'product:rare', name: 'Редкий' })),
        ...Array.from({ length: 9 }, () => entry({ key: 'product:often', name: 'Частый' })),
      ],
      settings,
      TODAY,
    );
    expect(pool.map((item) => item.name)).toEqual(['Частый', 'Редкий']);
  });

  it('питательность на единицу усредняется по записям', () => {
    const pool = buildPool(
      [
        entry({ per: { energyKcal: 4, proteinG: 0.1, carbsG: 0.6, fatG: 0.07, fiberG: 0.1 } }),
        entry({ per: { energyKcal: 3, proteinG: 0.2, carbsG: 0.6, fatG: 0.07, fiberG: 0.1 } }),
        entry({ per: { energyKcal: 3.5, proteinG: 0.15, carbsG: 0.6, fatG: 0.07, fiberG: 0.1 } }),
      ],
      settings,
      TODAY,
    );
    expect(pool[0].per.energyKcal).toBeCloseTo(3.5, 5);
    expect(pool[0].per.proteinG).toBeCloseTo(0.15, 5);
  });
});
