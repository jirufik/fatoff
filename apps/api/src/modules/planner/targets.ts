import {
  DEFAULT_TARGET_SETTINGS,
  message,
  type Message,
  type EnergyAvailabilityDto,
  type ExpenditureFactsDto,
  type MacroSetDto,
  type ProfileFactsDto,
  type TargetSettingsDto,
  type TargetsDto,
} from '@fatoff/contracts';

/**
 * Целевые числа — расчёт и цели YAZIO рядом.
 *
 * Ни базы, ни сети: на входе факты, на выходе числа. Всё, что здесь считается,
 * разобрано в docs/ANALYSIS-NUTRITION.md, § 3; каждая цифра несёт `basis` —
 * строку о том, откуда она взялась, потому что число без происхождения в
 * разговоре о здоровье бесполезно.
 */

/** Порог низкой энергодоступности у женщин, ккал/кг безжировой массы. */
export const EA_THRESHOLD = 30;
/** Оптимум по тому же консенсусу. */
export const EA_OPTIMAL = 45;

/** В одном килограмме жировой ткани примерно столько килокалорий. */
const KCAL_PER_KG = 7700;

export interface TargetsInput {
  sex: 'female' | 'male' | null;
  birthDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  /** Откуда взялась доля жира; `null` — её нет нигде, будет оценка по ИМТ. */
  bodyFatSource?: 'yazio' | 'health' | null;
  expenditure: {
    basalKcal: number | null;
    activeKcal: number | null;
    workoutKcalPerDay: number | null;
    daysCovered: number;
  };
  /** Сколько она ест сейчас — нужно для нынешней энергодоступности. */
  intakeKcal: number | null;
  yazio: MacroSetDto;
  settings?: Partial<TargetSettingsDto>;
  today: string;
}

/**
 * Формула Миффлина–Сан-Жеора.
 *
 * Попадает в ±10 % у большинства людей, но не у всех, поэтому в расчёте она
 * стоит рядом с измеренным базальным обменом, а не вместо него.
 */
export function mifflinStJeor(input: {
  sex: 'female' | 'male' | null;
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
}): number | null {
  const { sex, weightKg, heightCm, age } = input;
  if (weightKg === null || heightCm === null || age === null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return round(base + (sex === 'male' ? 5 : -161));
}

export function ageAt(birthDate: string | null, on: string): number | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  const at = new Date(`${on.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || Number.isNaN(at.getTime())) return null;

  let years = at.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < born.getUTCDate())) years--;
  return years >= 0 && years < 130 ? years : null;
}

export function resolveTargetSettings(over?: Partial<TargetSettingsDto>): TargetSettingsDto {
  return {
    ...DEFAULT_TARGET_SETTINGS,
    ...over,
    mealShares: { ...DEFAULT_TARGET_SETTINGS.mealShares, ...(over?.mealShares ?? {}) },
  };
}

export function computeTargets(input: TargetsInput): TargetsDto {
  const settings = resolveTargetSettings(input.settings);
  const warnings: Message[] = [];
  const basis: Record<string, Message> = {};

  const age = ageAt(input.birthDate, input.today);
  const weight = input.weightKg;
  const bmi = weight !== null && input.heightCm ? round(weight / (input.heightCm / 100) ** 2, 2) : null;

  // без доли жира не посчитать безжировую массу, а без неё — энергодоступность;
  // оценка по индексу массы тела хуже измерения, но лучше отказа считать
  const estimated = input.bodyFatPct === null ? deurenberg(bmi, age, input.sex) : null;
  const bodyFat = input.bodyFatPct ?? estimated;
  const leanMass = weight !== null && bodyFat !== null ? round(weight * (1 - bodyFat / 100), 1) : null;

  const profile: ProfileFactsDto = {
    sex: input.sex,
    age,
    heightCm: input.heightCm,
    weightKg: weight === null ? null : round(weight, 1),
    bodyFatPct: bodyFat,
    leanMassKg: leanMass,
    bmi,
  };

  const mifflin = mifflinStJeor({ sex: input.sex, weightKg: weight, heightCm: input.heightCm, age });
  const basal = input.expenditure.basalKcal;
  const active = input.expenditure.activeKcal;
  const total = basal !== null || active !== null ? round((basal ?? 0) + (active ?? 0)) : null;

  const expenditure: ExpenditureFactsDto = {
    basalKcal: basal,
    activeKcal: active,
    totalKcal: total,
    mifflinKcal: mifflin,
    workoutKcalPerDay: input.expenditure.workoutKcalPerDay,
    // из активной энергии вычитается то, что пришлось на записанные занятия:
    // остаётся обычное движение, которое будет и в день отдыха
    activeWithoutWorkoutsKcal:
      active === null ? null : Math.max(0, round(active - (input.expenditure.workoutKcalPerDay ?? 0))),
    daysCovered: input.expenditure.daysCovered,
  };

  if (basal !== null && mifflin !== null && Math.abs(basal - mifflin) / mifflin > 0.15) {
    warnings.push(message('targets.basal-mismatch', { basal, mifflin }));
  }
  if (total === null) {
    warnings.push(message('targets.no-health'));
  }

  // дефицит: % массы в неделю → ккал в день
  const deficit =
    weight !== null
      ? round((weight * (settings.lossRatePctPerWeek / 100) * KCAL_PER_KG) / 7)
      : null;

  const expenditureBase = total ?? mifflin;
  const energy =
    settings.energyOverrideKcal ??
    (expenditureBase !== null && deficit !== null ? round(expenditureBase - deficit) : null);

  const protein = weight !== null ? round(weight * settings.proteinPerKg) : null;
  const fat = weight !== null ? round(weight * settings.fatPerKg) : null;
  // углеводы — остаток: белок и жиры заданы на килограмм, они первичны
  const carbs =
    energy !== null && protein !== null && fat !== null
      ? Math.max(0, round((energy - protein * 4 - fat * 9) / 4))
      : null;
  const fiber = energy !== null ? round((energy / 1000) * settings.fiberPer1000Kcal) : null;

  const computed: MacroSetDto = {
    energyKcal: energy,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    fiberG: fiber,
  };

  if (energy !== null && protein !== null && (protein * 4) / energy > 0.35) {
    warnings.push(
      message('targets.protein-over-amdr', { percent: Math.round(((protein * 4) / energy) * 100) }),
    );
  }
  if (energy !== null && fat !== null && (fat * 9) / energy < 0.2) {
    warnings.push(
      message('targets.fat-under-amdr', { percent: Math.round(((fat * 9) / energy) * 100) }),
    );
  }
  if (settings.lossRatePctPerWeek > 1) {
    warnings.push(message('targets.loss-rate-high', { rate: settings.lossRatePctPerWeek }));
  }

  const workoutKcal = input.expenditure.workoutKcalPerDay ?? 0;
  const energyAvailability: EnergyAvailabilityDto = {
    current:
      leanMass && input.intakeKcal !== null
        ? round((input.intakeKcal - workoutKcal) / leanMass, 1)
        : null,
    atTarget: leanMass && energy !== null ? round((energy - workoutKcal) / leanMass, 1) : null,
    threshold: EA_THRESHOLD,
    optimal: EA_OPTIMAL,
  };

  if (energyAvailability.current !== null && energyAvailability.current < EA_THRESHOLD) {
    warnings.push(
      message('targets.ea-current-low', {
        value: energyAvailability.current,
        threshold: EA_THRESHOLD,
      }),
    );
  }
  if (energyAvailability.atTarget !== null && energyAvailability.atTarget < EA_THRESHOLD) {
    warnings.push(message('targets.ea-target-low', { threshold: EA_THRESHOLD }));
  }

  const proteinPerMeal = weight !== null ? round(weight * settings.proteinPerMealPerKg) : null;

  // вес приходит из YAZIO числом с плавающей точкой: 51.000000000000014 в
  // пояснении выглядит как ошибка расчёта, хотя это просто двоичная дробь
  const shownWeight = weight === null ? '—' : round(weight, 1);

  basis.energy = settings.energyOverrideKcal
    ? message('basis.energy-manual', { value: settings.energyOverrideKcal })
    : message('basis.energy', {
        expenditure: expenditureBase ?? '—',
        deficit: deficit ?? '—',
        rate: settings.lossRatePctPerWeek,
      });
  basis.protein = message('basis.protein', { perKg: settings.proteinPerKg, weight: shownWeight });
  basis.fat = message('basis.fat', { perKg: settings.fatPerKg, weight: shownWeight });
  basis.carbs = message('basis.carbs');
  basis.fiber = message('basis.fiber', { per1000: settings.fiberPer1000Kcal });
  basis.basal =
    basal !== null
      ? message('basis.basal-measured', {
          days: input.expenditure.daysCovered,
          mifflin: mifflin ?? '—',
        })
      : message('basis.basal-formula', { mifflin: mifflin ?? '—' });
  basis.deficit = message('basis.deficit', {
    rate: settings.lossRatePctPerWeek,
    weight: shownWeight,
  });
  basis.proteinPerMeal = message('basis.protein-per-meal', {
    perKg: settings.proteinPerMealPerKg,
  });
  basis.energyAvailability = message('basis.energy-availability');
  basis.bodyFat =
    input.bodyFatPct !== null
      ? message(input.bodyFatSource === 'health' ? 'basis.body-fat-health' : 'basis.body-fat-yazio')
      : estimated !== null
        ? message('basis.body-fat-estimated', { bmi: bmi ?? '—' })
        : message('basis.body-fat-unknown');

  if (input.bodyFatPct === null && estimated !== null) {
    warnings.push(message('targets.body-fat-estimated', { value: estimated }));
  }


  return {
    profile,
    expenditure,
    lossRatePctPerWeek: settings.lossRatePctPerWeek,
    deficitKcal: deficit,
    computed,
    yazio: input.yazio,
    diff: {
      energyKcal: diff(computed.energyKcal, input.yazio.energyKcal),
      proteinG: diff(computed.proteinG, input.yazio.proteinG),
      carbsG: diff(computed.carbsG, input.yazio.carbsG),
      fatG: diff(computed.fatG, input.yazio.fatG),
      fiberG: diff(computed.fiberG, input.yazio.fiberG),
    },
    proteinPerMealG: proteinPerMeal,
    energyAvailability,
    basis,
    warnings,
  };
}

/** Целевые числа конкретного дня: с прибавкой энергии тренировок, если она включена. */
export function dayTargets(
  targets: MacroSetDto,
  settings: TargetSettingsDto,
  workoutKcal: number,
): MacroSetDto {
  if (!settings.addWorkoutEnergy || workoutKcal <= 0 || targets.energyKcal === null) {
    return targets;
  }

  const energy = round(targets.energyKcal + workoutKcal);
  // белок и жиры привязаны к массе тела, а не к калорийности: прибавка уходит в
  // углеводы — топливо той самой тренировки, ради которой прибавка и появилась
  const carbs =
    targets.proteinG !== null && targets.fatG !== null
      ? Math.max(0, round((energy - targets.proteinG * 4 - targets.fatG * 9) / 4))
      : targets.carbsG;

  return { ...targets, energyKcal: energy, carbsG: carbs };
}

/**
 * Оценка доли жира по индексу массы тела (Deurenberg и соавт., 1991).
 *
 * Годится как замена отсутствующему замеру: на группе людей ошибается в
 * пределах нескольких процентов, на конкретном человеке может и больше. Поэтому
 * результат всегда помечается оценкой, а не выдаётся за измерение.
 */
export function deurenberg(
  bmi: number | null,
  age: number | null,
  sex: 'female' | 'male' | null,
): number | null {
  if (bmi === null || age === null) return null;
  const value = 1.2 * bmi + 0.23 * age - 10.8 * (sex === 'male' ? 1 : 0) - 5.4;
  return value > 0 && value < 70 ? round(value, 1) : null;
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : round(a - b, 1);
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
