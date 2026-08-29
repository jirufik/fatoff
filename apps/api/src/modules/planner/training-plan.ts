import {
  message,
  workoutGroup,
  type Message,
  type PlannedWorkoutDto,
  type TrainingSettingsDto,
  type WorkoutGroup,
} from '@fatoff/contracts';

/**
 * Расстановка тренировок на период.
 *
 * Четыре режима — все выбираются в интерфейсе, потому что «сколько тренироваться»
 * это не вопрос с одним ответом (docs/ANALYSIS-NUTRITION.md, § 3). Правила
 * расстановки при этом общие: они не про объём, а про восстановление.
 *
 * Виды и длительности берутся из её собственных тренировок, а не из таблиц: если
 * у неё ходьба — час на 130 ккал, подставлять сюда справочные 250 значит считать
 * чужой день.
 */

/** Доля дефицита, которую в режиме «под цель» набирают движением, а не едой. */
const MOVEMENT_SHARE = 0.4;
/** Границы, между которыми держится объём режима «под цель». */
const GOAL_SESSIONS: [number, number] = [3, 7];
/** Сон короче — объём срезается: тренироваться больше, чем восстанавливаешься, некуда. */
const SHORT_SLEEP_MIN = 420;
const SHORT_SLEEP_CAP = 5;

/** По ВОЗ: 150–300 минут умеренного кардио и два силовых дня в неделю. */
export const WHO_CARDIO_MIN: [number, number] = [150, 300];
export const WHO_STRENGTH_DAYS = 2;
const WHO_CARDIO_SESSIONS = 3;

/** Кардио дольше этого считается длинным и не ставится в один день с силовой. */
const LONG_CARDIO_MIN = 45;

export interface TrainingTypeStat {
  type: string;
  group: WorkoutGroup;
  avgMin: number;
  avgKcal: number;
  count: number;
}

export interface TrainingProfile {
  types: TrainingTypeStat[];
  /** Нынешний объём, занятий в неделю. */
  sessionsPerWeek: number;
  /** Насколько часто она тренируется по дням недели; индекс 0 — понедельник. */
  weekdayLoad: number[];
  medianSleepMin: number | null;
}

export interface TrainingContext {
  deficitKcal: number | null;
}

export interface TrainingPlan {
  byDate: Map<string, PlannedWorkoutDto[]>;
  notes: Message[];
}

export function planTraining(
  dates: string[],
  profile: TrainingProfile,
  settings: TrainingSettingsDto,
  context: TrainingContext,
  rng: () => number,
): TrainingPlan {
  const notes: Message[] = [];
  const byDate = new Map<string, PlannedWorkoutDto[]>();
  for (const date of dates) byDate.set(date, []);

  if (settings.mode === 'manual') {
    const manual = settings.manual ?? [];
    if (manual.length === 0) {
      notes.push(message('training.manual-empty'));
    }
    for (const date of dates) {
      const weekday = isoWeekday(date);
      byDate.set(
        date,
        manual
          .filter((entry) => entry.weekday === weekday)
          .map((entry) => toWorkout(entry.type, entry.durationMin, profile)),
      );
    }
    return { byDate, notes };
  }

  const week = weeklySessions(profile, settings, context, notes);
  if (week.length === 0) {
    notes.push(message('training.no-history'));
    return { byDate, notes };
  }

  // расставляем по неделям: правила восстановления живут внутри недели
  let strengthOnPreviousSunday = false;
  for (const days of weeksOf(dates)) {
    const placed = placeWeek(week, profile.weekdayLoad, strengthOnPreviousSunday, rng);

    for (const date of days) {
      byDate.set(date, placed[isoWeekday(date) - 1] ?? []);
    }

    const lastDay = isoWeekday(days[days.length - 1]) - 1;
    strengthOnPreviousSunday = (placed[lastDay] ?? []).some((workout) => workout.group === 'strength');
  }

  return { byDate, notes };
}

/** Состав недели: сколько занятий и каких. */
function weeklySessions(
  profile: TrainingProfile,
  settings: TrainingSettingsDto,
  context: TrainingContext,
  notes: Message[],
): PlannedWorkoutDto[] {
  const cardio = profile.types.filter((type) => type.group === 'cardio');
  const strength = profile.types.filter((type) => type.group === 'strength');

  if (settings.mode === 'who') {
    const strengthCount = settings.strengthPerWeek ?? WHO_STRENGTH_DAYS;
    const cardioCount = Math.max(
      1,
      (settings.sessionsPerWeek ?? WHO_CARDIO_SESSIONS + strengthCount) - strengthCount,
    );
    const perSession = Math.round(WHO_CARDIO_MIN[0] / cardioCount);

    notes.push(
      message('training.who', {
        cardio: cardioCount,
        perSession,
        weekly: perSession * cardioCount,
        min: WHO_CARDIO_MIN[0],
        max: WHO_CARDIO_MIN[1],
        strength: strengthCount,
      }),
    );

    return [
      ...take(strength, strengthCount).map((type) => toWorkout(type.type, type.avgMin, profile)),
      ...take(cardio, cardioCount).map((type) => toWorkout(type.type, perSession, profile)),
    ];
  }

  let count: number;
  if (settings.mode === 'goal') {
    const deficit = context.deficitKcal ?? 0;
    const perSession = averageKcal(profile);
    const weekly = deficit * 7 * MOVEMENT_SHARE;
    count =
      perSession > 0
        ? clamp(Math.round(weekly / perSession), GOAL_SESSIONS[0], GOAL_SESSIONS[1])
        : GOAL_SESSIONS[0];

    if (
      profile.medianSleepMin !== null &&
      profile.medianSleepMin < SHORT_SLEEP_MIN &&
      count > SHORT_SLEEP_CAP
    ) {
      notes.push(
        message('training.capped-by-sleep', {
          cap: SHORT_SLEEP_CAP,
          hours: (profile.medianSleepMin / 60).toFixed(1),
        }),
      );
      count = SHORT_SLEEP_CAP;
    }

    notes.push(
      message('training.goal', {
        count,
        share: Math.round(MOVEMENT_SHARE * 100),
        perSession: Math.round(perSession),
      }),
    );
  } else {
    count = settings.sessionsPerWeek ?? Math.round(profile.sessionsPerWeek);
    notes.push(message('training.current', { count }));
  }

  return composeWeek(profile, clamp(count, 0, 10), settings.strengthPerWeek);
}

/**
 * Состав недели по её же долям: чем чаще вид встречается в истории, тем больше
 * его в плане. Силовых при этом не меньше двух — нижняя граница ВОЗ не зависит
 * от того, сколько силовых было раньше.
 */
function composeWeek(
  profile: TrainingProfile,
  count: number,
  strengthPerWeek?: number,
): PlannedWorkoutDto[] {
  if (count <= 0) return [];

  const strengthTypes = profile.types.filter((type) => type.group === 'strength');
  const otherTypes = profile.types.filter((type) => type.group !== 'strength');

  const wantStrength =
    strengthTypes.length === 0 ? 0 : Math.min(count, strengthPerWeek ?? Math.min(WHO_STRENGTH_DAYS, count));

  const sessions: PlannedWorkoutDto[] = [];
  for (let i = 0; i < wantStrength; i++) {
    const type = strengthTypes[i % strengthTypes.length];
    sessions.push(toWorkout(type.type, type.avgMin, profile));
  }

  const rest = count - sessions.length;
  const pool = otherTypes.length > 0 ? otherTypes : profile.types;
  if (pool.length === 0 || rest <= 0) return sessions;

  // остаток раскладывается по долям: самый частый вид получает больше всех
  const total = pool.reduce((sum, type) => sum + type.count, 0) || 1;
  const quota = pool
    .map((type) => ({ type, want: (type.count / total) * rest }))
    .sort((a, b) => b.want - a.want);

  let placed = 0;
  for (const { type, want } of quota) {
    for (let i = 0; i < Math.round(want) && placed < rest; i++) {
      sessions.push(toWorkout(type.type, type.avgMin, profile));
      placed++;
    }
  }
  // округление долей могло недобрать — добираем самым частым видом
  while (placed < rest) {
    sessions.push(toWorkout(pool[0].type, pool[0].avgMin, profile));
    placed++;
  }

  return sessions;
}

/**
 * Расстановка недели.
 *
 * Три правила, и все про восстановление, а не про удобство: силовые не два дня
 * подряд, длинное кардио не в один день с силовой, хотя бы один день полного
 * отдыха. День отдыха резервируется до расстановки: иначе при семи занятиях в
 * неделю он просто не остаётся, а сохранить объём и дать отдых можно — подсадив
 * второе занятие к самому лёгкому дню.
 */
export function placeWeek(
  sessions: PlannedWorkoutDto[],
  weekdayLoad: number[],
  strengthOnPreviousSunday: boolean,
  rng: () => number,
): PlannedWorkoutDto[][] {
  const days: PlannedWorkoutDto[][] = Array.from({ length: 7 }, () => []);
  const load = weekdayLoad.length === 7 ? weekdayLoad : new Array<number>(7).fill(1);

  // предпочтения — по её собственной привычке; ничья решается зерном, а не порядком в массиве
  const order = [...Array(7).keys()].sort((a, b) => load[b] - load[a] || (rng() < 0.5 ? -1 : 1));
  const rest = order[order.length - 1];
  const usable = order.filter((day) => day !== rest);

  const hasStrength = (day: number): boolean =>
    day >= 0 && day <= 6 && days[day].some((workout) => workout.group === 'strength');
  const hasLongCardio = (day: number): boolean =>
    days[day].some((workout) => workout.group === 'cardio' && workout.durationMin > LONG_CARDIO_MIN);

  // силовые расставляются первыми: у них самое жёсткое ограничение
  for (const session of [...sessions].sort((a, b) => rank(a) - rank(b))) {
    const fits = (day: number): boolean => {
      if (session.group === 'strength') {
        if (hasStrength(day - 1) || hasStrength(day + 1)) return false;
        if (day === 0 && strengthOnPreviousSunday) return false;
        if (hasLongCardio(day)) return false;
      }
      if (session.group === 'cardio' && session.durationMin > LONG_CARDIO_MIN && hasStrength(day)) {
        return false;
      }
      return true;
    };

    const free = usable.find((day) => days[day].length === 0 && fits(day));
    if (free !== undefined) {
      days[free].push(session);
      continue;
    }

    // свободных дней не осталось — занятие подсаживается к самому лёгкому подходящему
    const shared = usable
      .filter((day) => fits(day))
      .sort((a, b) => minutesOf(days[a]) - minutesOf(days[b]))[0];
    days[shared ?? usable[usable.length - 1]].push(session);
  }

  return days;
}

function rank(workout: PlannedWorkoutDto): number {
  if (workout.group === 'strength') return 0;
  if (workout.durationMin > LONG_CARDIO_MIN) return 1;
  return 2;
}

function minutesOf(workouts: PlannedWorkoutDto[]): number {
  return workouts.reduce((sum, workout) => sum + workout.durationMin, 0);
}

function toWorkout(type: string, durationMin: number, profile: TrainingProfile): PlannedWorkoutDto {
  const stat = profile.types.find((candidate) => candidate.type === type);
  // затраты — её собственные на минуту этого вида; для вида без истории берётся
  // умеренная нагрузка около 3.5 ккал в минуту
  const perMinute = stat && stat.avgMin > 0 ? stat.avgKcal / stat.avgMin : 3.5;
  const minutes = Math.max(5, Math.round(durationMin));

  return {
    type,
    group: stat?.group ?? workoutGroup(type),
    durationMin: minutes,
    energyKcal: Math.round(minutes * perMinute),
  };
}

function averageKcal(profile: TrainingProfile): number {
  const total = profile.types.reduce((sum, type) => sum + type.avgKcal * type.count, 0);
  const count = profile.types.reduce((sum, type) => sum + type.count, 0);
  return count > 0 ? total / count : 0;
}

function take<T>(list: T[], count: number): T[] {
  if (list.length === 0) return [];
  return Array.from({ length: count }, (_, index) => list[index % list.length]);
}

/** Недели периода: календарные, от понедельника. */
function weeksOf(dates: string[]): string[][] {
  const weeks: string[][] = [];
  let current: string[] = [];

  for (const date of dates) {
    if (current.length > 0 && isoWeekday(date) === 1) {
      weeks.push(current);
      current = [];
    }
    current.push(date);
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}

export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
