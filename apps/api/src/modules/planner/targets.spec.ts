import { describe, expect, it } from 'vitest';

import {
  ageAt,
  computeTargets,
  dayTargets,
  mifflinStJeor,
  resolveTargetSettings,
  type TargetsInput,
} from './targets';

/**
 * Условный профиль: женщина, 1990-06-04, 165 см, 60 кг, жир 28 %.
 *
 * Числа выдуманы и round-friendly намеренно: по ним считаются ожидания в
 * тестах, и проверить их в уме должно быть можно. Ничьи настоящие замеры в
 * репозиторий не попадают.
 */
const base = (over: Partial<TargetsInput> = {}): TargetsInput => ({
  sex: 'female',
  birthDate: '1990-06-04',
  heightCm: 165,
  weightKg: 60,
  bodyFatPct: 28,
  expenditure: { basalKcal: 1400, activeKcal: 500, workoutKcalPerDay: 150, daysCovered: 365 },
  intakeKcal: 1400,
  yazio: { energyKcal: 1200, proteinG: 125, carbsG: 100, fatG: 33, fiberG: null },
  today: '2026-08-28',
  ...over,
});

/** Тесты проверяют коды сообщений, а не формулировки: текст живёт в словарях. */
const codes = (list: Array<{ code: string }>): string[] => list.map((item) => item.code);

describe('нормы', () => {
  it('считает возраст на дату, а не по году рождения', () => {
    expect(ageAt('1990-06-04', '2026-08-28')).toBe(36);
    expect(ageAt('1990-06-04', '2026-06-03')).toBe(35);
    expect(ageAt('1990-06-04', '2026-06-04')).toBe(36);
    expect(ageAt(null, '2026-08-28')).toBeNull();
  });

  it('формула Миффлина–Сан-Жеора даёт известные значения', () => {
    // 10×60 + 6.25×165 − 5×36 − 161 = 1290
    expect(mifflinStJeor({ sex: 'female', weightKg: 60, heightCm: 165, age: 36 })).toBe(1290);
    // мужской вариант отличается на 166 ккал
    expect(mifflinStJeor({ sex: 'male', weightKg: 60, heightCm: 165, age: 36 })).toBe(1456);
    expect(mifflinStJeor({ sex: 'female', weightKg: null, heightCm: 165, age: 36 })).toBeNull();
  });

  it('расход берёт измеренный, а формулу оставляет рядом для проверки', () => {
    const targets = computeTargets(base());
    expect(targets.expenditure.totalKcal).toBe(1900);
    expect(targets.expenditure.mifflinKcal).toBe(1290);
    expect(targets.basis.basal).toEqual({
      code: 'basis.basal-measured',
      params: { days: 365, mifflin: 1290 },
    });
  });

  it('дефицит выводится из темпа снижения веса', () => {
    // 0.65 % × 60 кг × 7700 ккал/кг ÷ 100 ÷ 7 дней = 429
    expect(computeTargets(base()).deficitKcal).toBe(429);
    expect(computeTargets(base({ settings: { lossRatePctPerWeek: 1.3 } })).deficitKcal).toBe(858);
  });

  it('макросы в сумме дают ровно целевые калории', () => {
    const { computed } = computeTargets(base());
    expect(computed.energyKcal).toBe(1900 - 429);
    expect(computed.proteinG).toBe(108); // 1.8 × 60
    expect(computed.fatG).toBe(54); // 0.9 × 60

    const fromMacros = computed.proteinG! * 4 + computed.carbsG! * 4 + computed.fatG! * 9;
    expect(Math.abs(fromMacros - computed.energyKcal!)).toBeLessThanOrEqual(4);
  });

  it('клетчатка считается от калорийности', () => {
    expect(computeTargets(base()).computed.fiberG).toBe(21); // 14 г на 1000 ккал: 1471 × 0.014
  });

  it('показывает цели YAZIO рядом и разницу с расчётом', () => {
    const targets = computeTargets(base());
    expect(targets.yazio.energyKcal).toBe(1200);
    expect(targets.diff.energyKcal).toBe(271);
    expect(targets.diff.proteinG).toBe(-17);
    // сравнивать не с чем — разницы нет, а не ноль
    expect(targets.diff.fiberG).toBeNull();
  });

  it('ручное задание калорий отменяет расчёт', () => {
    const targets = computeTargets(base({ settings: { energyOverrideKcal: 1600 } }));
    expect(targets.computed.energyKcal).toBe(1600);
    expect(targets.basis.energy.code).toBe('basis.energy-manual');
  });

  it('считает энергодоступность сейчас и при целях, замечает порог', () => {
    const targets = computeTargets(base());
    // безжировая масса 60 × 0.72 = 43.2 кг; (1400 − 150) / 43.2 = 28.9
    expect(targets.profile.leanMassKg).toBe(43.2);
    expect(targets.energyAvailability.current).toBe(28.9);
    expect(targets.energyAvailability.atTarget).toBe(30.6);
    expect(codes(targets.warnings)).toContain('targets.ea-current-low');
  });

  it('предупреждает, когда белок выходит за 35 % калорийности', () => {
    const targets = computeTargets(
      base({ settings: { proteinPerKg: 2.4, energyOverrideKcal: 1300 } }),
    );
    expect(targets.warnings).toContainEqual({
      code: 'targets.protein-over-amdr',
      params: { percent: 44 },
    });
  });

  it('предупреждает, когда жиров меньше пятой части калорийности', () => {
    const targets = computeTargets(base({ settings: { fatPerKg: 0.5 } }));
    expect(codes(targets.warnings)).toContain('targets.fat-under-amdr');
  });

  it('без данных Apple Health считает от формулы и говорит об этом', () => {
    const targets = computeTargets(
      base({
        expenditure: { basalKcal: null, activeKcal: null, workoutKcalPerDay: null, daysCovered: 0 },
      }),
    );
    expect(targets.computed.energyKcal).toBe(1290 - 429);
    expect(codes(targets.warnings)).toContain('targets.no-health');
  });

  it('без веса не выдумывает цифры', () => {
    const targets = computeTargets(base({ weightKg: null, bodyFatPct: null }));
    expect(targets.computed.proteinG).toBeNull();
    expect(targets.deficitKcal).toBeNull();
    expect(targets.energyAvailability.current).toBeNull();
  });
});

describe('цели дня', () => {
  const settings = resolveTargetSettings();
  const targets = { energyKcal: 1471, proteinG: 108, carbsG: 138, fatG: 54, fiberG: 21 };

  it('по умолчанию все дни плана одинаковы по калорийности', () => {
    // ровные дни — просьба заказчика (D-074): тренировка цель не двигает
    expect(dayTargets(targets, settings, 300)).toEqual(targets);
  });

  it('прибавляет энергию тренировки, когда прибавку включили', () => {
    const on = resolveTargetSettings({ addWorkoutEnergy: true });
    const day = dayTargets(targets, on, 300);
    expect(day.energyKcal).toBe(1771);
    // прибавка уходит в углеводы: белок и жиры привязаны к массе тела
    expect(day.proteinG).toBe(108);
    expect(day.fatG).toBe(54);
    // (1771 − 108×4 − 54×9) ÷ 4 = 213
    expect(day.carbsG).toBe(213);
  });

  it('в день без тренировки ничего не меняет', () => {
    const on = resolveTargetSettings({ addWorkoutEnergy: true });
    expect(dayTargets(targets, on, 0)).toEqual(targets);
  });
});
