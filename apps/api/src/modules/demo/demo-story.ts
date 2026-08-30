/**
 * Полгода жизни демо-героини: что она ела, сколько ходила и как менялся вес.
 *
 * Сюжет выбран не для красоты. Ровный дефицит без событий показывает только то,
 * что графики рисуются; смысл сервиса виден там, где идёт не по плану: бодрый
 * старт, плато посреди, выходные с перебором, дни без записей. Именно на таких
 * данных видно, зачем нужны и оценка дня, и баланс, и тренд веса (D-068).
 *
 * Числа детерминированные: один и тот же день выглядит одинаково при каждой
 * генерации. Случайность здесь — не источник разнообразия, а способ убрать
 * машинную ровность; воспроизводимость важнее, иначе о демо нельзя ничего
 * утверждать ни в тестах, ни в разговоре.
 */

/** Длина истории: полгода — тренд виден, база не толстеет. */
export const DEMO_DAYS = 180;

export interface DemoWorkout {
  type: string;
  /** Минута суток, когда началась. */
  startMin: number;
  durationMin: number;
  kcal: number;
  distanceKm: number | null;
}

export interface DemoSleep {
  inBedMin: number;
  asleepMin: number;
  deepMin: number;
  remMin: number;
  coreMin: number;
  awakeMin: number;
  fellAsleepMin: number;
}

export interface DemoDay {
  date: string;
  /** Вела ли она в этот день дневник питания. */
  logged: boolean;
  /** К какой калорийности стремится набор еды этого дня. */
  intakeKcal: number;
  /** Носила ли часы: пара дней без данных — тоже правда. */
  tracked: boolean;
  /** День, когда ужин приехал в коробке: белок и клетчатка проседают. */
  splurge: boolean;
  steps: number;
  exerciseMin: number;
  standHours: number;
  restingHr: number;
  basalKcal: number;
  activeKcal: number;
  distanceKm: number;
  flights: number;
  sleep: DemoSleep | null;
  workout: DemoWorkout | null;
  weightKg: number | null;
  bodyFatPct: number | null;
}

export interface DemoStory {
  profile: {
    sex: 'female';
    birthDate: string;
    heightCm: number;
    startWeightKg: number;
  };
  from: string;
  to: string;
  days: DemoDay[];
}

/**
 * Генератор псевдослучайных чисел с явным зерном.
 *
 * `Math.random()` не годится: демо должно получаться одинаковым, иначе тест на
 * него не написать. Mulberry32 — тридцать строк арифметики без зависимостей.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addDays = (date: string, shift: number): string => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + shift);
  return at.toISOString().slice(0, 10);
};

const round = (value: number, digits = 0): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Три отрезка полугода — задаются дефицитом, а не скоростью снижения.
 *
 * Вес не рисуется по заранее выбранной кривой: он считается из баланса того же
 * дня, который показывает сервис. Иначе демо спорило бы само с собой — на
 * странице дней недельный дефицит один, а весы падают так, будто он вдвое
 * больше, и первый же, кто сложит числа, поймал бы сервис на вранье.
 *
 * Сначала она держит строгий дефицит, потом делает перерыв — вес встаёт, — потом
 * возвращается к умеренному. Плато берётся не из отдельного правила, а из того,
 * что дефицит на это время почти сходит на нет.
 */
const PHASES: Array<{ untilDay: number; deficitKcal: number }> = [
  { untilDay: 42, deficitKcal: 500 },
  { untilDay: 98, deficitKcal: 150 },
  { untilDay: DEMO_DAYS, deficitKcal: 400 },
];

/** Сколько энергии в килограмме жировой ткани: общепринятая оценка. */
const KCAL_PER_KG = 7700;

/** Какая доля снижения приходится на жир, а не на мышцы и воду. */
const FAT_SHARE = 0.75;

const phaseOf = (index: number): (typeof PHASES)[number] =>
  PHASES.find((phase) => index < phase.untilDay) ?? PHASES[PHASES.length - 1]!;

/** Виды тренировок берутся из общего словаря, поэтому переводятся сами. */
const WORKOUT_PLAN: Record<number, { type: string; durationMin: number; distanceKm: number | null }> = {
  1: { type: 'TraditionalStrengthTraining', durationMin: 55, distanceKm: null },
  3: { type: 'Running', durationMin: 38, distanceKm: 6.2 },
  5: { type: 'FunctionalStrengthTraining', durationMin: 45, distanceKm: null },
  6: { type: 'Walking', durationMin: 70, distanceKm: 5.4 },
};

/**
 * Собрать историю, заканчивающуюся вчерашним днём.
 *
 * Заканчивается вчера, а не сегодня: сегодняшний день у живого человека ещё не
 * дописан, и пустой вечер в демо выглядел бы поломкой, а не сегодняшним днём.
 */
export function buildStory(today: string, seed = 20260830): DemoStory {
  const random = mulberry32(seed);
  const to = addDays(today, -1);
  const from = addDays(to, -(DEMO_DAYS - 1));

  const heightCm = 168;
  const startWeightKg = 74;
  const birthDate = `${Number(today.slice(0, 4)) - 32}-03-12`;

  let weight = startWeightKg;
  /** Жировая масса: из неё уходит большая часть снижения, остальное — мышцы и вода. */
  let fatKg = startWeightKg * 0.324;
  const days: DemoDay[] = [];

  for (let index = 0; index < DEMO_DAYS; index += 1) {
    const date = addDays(from, index);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const phase = phaseOf(index);

    // ── сколько потрачено ───────────────────────────────────────────────────
    // основной обмен по Миффлину-Сан Жеору: он же лежит в расчёте норм, и
    // демо не должно спорить с собственным планировщиком
    const age = 32;
    const basal = 10 * weight + 6.25 * heightCm - 5 * age - 161;

    const plan = WORKOUT_PLAN[weekday];
    // тренировки пропускаются примерно каждую пятую: жизнь
    const trains = plan !== undefined && random() > 0.22;

    const workoutKcal = trains ? Math.round(plan.durationMin * (plan.type === 'Running' ? 9.4 : 6.2)) : 0;

    /*
     * Раз в две недели случается день, когда она почти не двигается: работа из
     * дома, дождь, недомогание. Без таких дней шаги всегда близки к цели, и
     * составляющая «шаги» в оценке перестаёт что-либо значить.
     */
    const sedentary = random() < 0.07;
    const baseSteps = sedentary ? 3600 : weekend ? 7200 : 9100;
    const steps = Math.round(
      baseSteps + (random() - 0.4) * (sedentary ? 1800 : 4200) + (trains && !sedentary ? 1500 : 0),
    );
    const activeKcal = Math.round(steps * 0.042 + workoutKcal * 0.85);
    /*
     * Минуты движения — не все минуты на ногах.
     *
     * Часы засчитывают только бодрый темп, поэтому девять тысяч шагов дают
     * около двадцати минут, а не тридцать пять. При щедром пересчёте
     * составляющая «движение» в оценке дня всегда полная и ничего не значит.
     */
    const exerciseMin = Math.round(steps / 450 + (trains ? plan.durationMin * 0.8 : 0));

    // ── сколько съедено ─────────────────────────────────────────────────────
    // цель дня — расход минус дефицит фазы; в выходные она обычно превышается
    const spend = basal + activeKcal;

    /*
     * Срыв: доставка вместо ужина. Случается чаще в выходные и на плато, когда
     * дефицит и так почти снят, — то есть тогда же, когда это случается в жизни.
     */
    const splurge = random() < (weekend ? 0.22 : 0.08);
    const overshoot = splurge
      ? 380 + random() * 280
      : weekend
        ? 120 + random() * 220
        : random() < 0.1
          ? 200 + random() * 220
          : 0;
    const intake = Math.round(spend - phase.deficitKcal + overshoot + (random() - 0.5) * 160);

    // дневник ведётся не каждый день: пропуски обычно на выходных
    const logged = random() > (weekend ? 0.16 : 0.05);
    // часы иногда остаются дома
    const tracked = random() > 0.02;

    // ── ночь ────────────────────────────────────────────────────────────────
    const asleep = Math.round((weekend ? 455 : 405) + (random() - 0.45) * 90);
    const awake = Math.round(12 + random() * 22);
    const deep = Math.round(asleep * (0.14 + random() * 0.05));
    const rem = Math.round(asleep * (0.19 + random() * 0.05));

    // ── взвешивания ─────────────────────────────────────────────────────────
    // не каждый день и с шумом: весы показывают воду, а не только жир
    const weighed = random() > 0.42;
    const noise = (random() - 0.5) * 0.7;

    days.push({
      date,
      logged,
      intakeKcal: intake,
      tracked,
      splurge,
      steps,
      exerciseMin,
      standHours: Math.round(9 + random() * 5),
      restingHr: Math.round(64 - index * 0.018 + (random() - 0.5) * 3),
      basalKcal: Math.round(basal * 0.98),
      activeKcal,
      distanceKm: round(steps * 0.00072, 2),
      flights: Math.round(3 + random() * 14),
      sleep: tracked
        ? {
            inBedMin: asleep + awake + Math.round(8 + random() * 14),
            asleepMin: asleep,
            deepMin: deep,
            remMin: rem,
            coreMin: asleep - deep - rem,
            awakeMin: awake,
            fellAsleepMin: Math.round(23 * 60 + (random() - 0.4) * 70),
          }
        : null,
      workout:
        trains && plan
          ? {
              type: plan.type,
              startMin: Math.round((weekend ? 10 : 18) * 60 + (random() - 0.5) * 80),
              durationMin: plan.durationMin + Math.round((random() - 0.5) * 12),
              kcal: workoutKcal,
              distanceKm: plan.distanceKm === null ? null : round(plan.distanceKm + (random() - 0.5) * 1.4, 2),
            }
          : null,
      weightKg: weighed ? round(weight + noise, 1) : null,
      // состав тела снимают умные весы, и делают это реже
      bodyFatPct:
        weighed && index % 7 === 3 ? round((fatKg / weight) * 100 + (random() - 0.5) * 0.6, 1) : null,
    });

    /*
     * Вес завтрашнего утра — из баланса сегодняшнего дня.
     *
     * Ровно того баланса, который сервис покажет на странице дней: съедено
     * минус потрачено. Дни, которые она не записала, тело всё равно посчитало,
     * поэтому берётся смоделированная еда, а не только занесённая в дневник.
     */
    const balance = intake - spend;
    weight += balance / KCAL_PER_KG;
    fatKg += (balance / KCAL_PER_KG) * FAT_SHARE;
  }

  return {
    profile: { sex: 'female', birthDate, heightCm, startWeightKg },
    from,
    to,
    days,
  };
}
