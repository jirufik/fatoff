import type { Granularity } from '@fatoff/contracts';

import { dateRange, daysBetween, monthStart, weekStart } from '../../../common/date.util';
import { NUTRIENTS } from '../nutrients';
import type { BuildWarning, ExportSource } from '../source';
import type { MetaInfo } from '../tables/meta';
import { totalsBy, type DiaryEntry } from '../tables/diary';

/**
 * Markdown-дайджест — то, ради чего всё затевалось.
 *
 * Один файл, который вставляется в чат с языковой моделью: факты, единицы и
 * оговорки, но без выводов. Норм потребления здесь нет намеренно (D-009):
 * модель получает пол, возраст, рост, вес и цель и сравнивает с нормами сама.
 */

/** Порог, за которым дневной ряд перестаёт помещаться в контекст модели. */
const DAYS_FOR_DAILY = 400;
const DAYS_FOR_WEEKLY = 1200;

const MEALS: Record<string, string> = {
  breakfast: 'завтрак',
  lunch: 'обед',
  dinner: 'ужин',
  snack: 'перекус',
};

interface DayPoint {
  date: string;
  energy: number | null;
  energyGoal: number | null;
  carb: number | null;
  protein: number | null;
  fat: number | null;
  fiber: number | null;
  steps: number | null;
  weight: number | null;
  /** Из Apple Health, если выгрузка загружена. */
  spent: number | null;
  balance: number | null;
  asleep: number | null;
}

interface Stats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
}

function stats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median:
      sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    min: sorted[0],
    max: sorted.at(-1)!,
  };
}

const fmt = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const fmtInt = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : String(Math.round(value));

function table(header: string[], rows: string[][]): string {
  const lines = [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function resolveGranularity(requested: Granularity, days: number): Exclude<Granularity, 'auto'> {
  if (requested !== 'auto') return requested;
  if (days <= DAYS_FOR_DAILY) return 'day';
  return days <= DAYS_FOR_WEEKLY ? 'week' : 'month';
}

/** Дневной ряд: то, из чего собирается и таблица периода, и вся статистика. */
function dailySeries(source: ExportSource, entries: DiaryEntry[]): DayPoint[] {
  const computed = totalsBy(entries, (entry) => entry.date);

  // за день бывает несколько взвешиваний — берём последнее
  const weights = new Map<string, number>();
  for (const value of source.bodyValues.filter((v) => v.kind === 'weight').sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))) {
    weights.set(value.date, value.value);
  }

  return dateRange(source.from, source.to).map((date) => {
    const totals = source.dailyNutrients.get(date);
    const day = source.days.get(date);
    const activity = day?.exercises?.activity ?? null;
    const summary = source.dailyExercise.get(date);
    const nutrients = computed.get(date)?.nutrients;

    const health = source.health?.days.get(date);
    const spent =
      health && (health.activeKcal !== null || health.basalKcal !== null)
        ? (health.activeKcal ?? 0) + (health.basalKcal ?? 0)
        : null;
    const eaten = totals?.energy ?? null;

    return {
      date,
      energy: eaten,
      energyGoal: totals?.energyGoal ?? null,
      carb: totals?.carb ?? null,
      protein: totals?.protein ?? null,
      fat: totals?.fat ?? null,
      fiber: nutrients?.display('nutrient.dietaryfiber') ?? null,
      // шаги из Apple Health точнее: YAZIO берёт их оттуда же, но не всегда
      steps: health?.steps ?? summary?.steps ?? activity?.steps ?? null,
      weight: weights.get(date) ?? health?.weightKg ?? null,
      spent,
      balance: eaten !== null && spent !== null ? eaten - spent : null,
      asleep: source.health?.sleep.get(date)?.asleepMin ?? null,
    };
  });
}

/** Свёртка ряда по неделям или месяцам: средние по дням, где данные есть. */
function collapse(series: DayPoint[], granularity: 'week' | 'month'): DayPoint[] {
  const buckets = new Map<string, DayPoint[]>();
  for (const point of series) {
    const key = granularity === 'week' ? weekStart(point.date) : monthStart(point.date);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  const average = (points: DayPoint[], pick: (p: DayPoint) => number | null): number | null => {
    const values = points.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  };

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, points]) => ({
      date,
      energy: average(points, (p) => p.energy),
      energyGoal: average(points, (p) => p.energyGoal),
      carb: average(points, (p) => p.carb),
      protein: average(points, (p) => p.protein),
      fat: average(points, (p) => p.fat),
      fiber: average(points, (p) => p.fiber),
      steps: average(points, (p) => p.steps),
      weight: average(points, (p) => p.weight),
      spent: average(points, (p) => p.spent),
      balance: average(points, (p) => p.balance),
      asleep: average(points, (p) => p.asleep),
    }));
}

/** Наклон линейной регрессии веса, кг в неделю. */
function weightTrend(source: ExportSource): number | null {
  const points = source.bodyValues
    .filter((value) => value.kind === 'weight')
    .map((value) => ({ x: daysBetween(source.from, value.date), y: value.value }));
  if (points.length < 3) return null;

  const n = points.length;
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXy = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumXx = points.reduce((sum, p) => sum + p.x * p.x, 0);
  const denominator = n * sumXx - sumX * sumX;
  if (denominator === 0) return null;

  return ((n * sumXy - sumX * sumY) / denominator) * 7;
}

function ageAt(dateOfBirth: string | null | undefined, on: string): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  const at = new Date(`${on}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < born.getUTCDate())) age--;
  return age;
}

export interface DigestOptions {
  granularity: Granularity;
  accountLabel: string | null;
}

export function renderMarkdown(
  source: ExportSource,
  entries: DiaryEntry[],
  meta: MetaInfo,
  warnings: BuildWarning[],
  options: DigestOptions,
): string {
  const series = dailySeries(source, entries);
  const daysInRange = series.length;
  const granularity = resolveGranularity(options.granularity, daysInRange);
  const withFood = series.filter((point) => point.energy !== null);

  const out: string[] = [];
  const push = (...lines: string[]): void => {
    out.push(...lines, '');
  };

  // ── шапка ────────────────────────────────────────────────────────────────
  const title = source.redact ? 'Выгрузка YAZIO' : `Выгрузка YAZIO — ${options.accountLabel ?? ''}`;
  push(`# ${title.trim()}`);
  push(
    `Период: **${source.from} — ${source.to}** (${daysInRange} дн.). ` +
      `Дней с записями о еде: **${withFood.length}**. ` +
      `Собрано: ${meta.generatedAt}.`,
  );

  push('## Как читать этот файл');
  push(
    '- Энергия — в килокалориях, масса — в граммах, если в названии колонки не сказано иначе (`_mg`, `_ug`).',
    '- Прочерк или пустое значение означает **«не отслеживается»**, а не ноль. YAZIO не присылает нутриент, о котором ничего не знает.',
    '- Дневные итоги по калориям и БЖУ взяты у YAZIO как есть; остальные нутриенты досчитаны по карточкам продуктов.',
    '- Файл содержит только факты. Сравнение с нормами потребления и любые выводы — за тем, кто его читает.',
    ...(source.health
      ? [
          '- Данные Apple Health сведены по дням: на каждый день и показатель взят один источник — часы и телефон считают шаги независимо, и складывать их нельзя.',
          '- Питание из Apple Health в расчёте не участвует: туда его пишет сам YAZIO, это не второй независимый источник.',
        ]
      : []),
  );

  // ── профиль и цели ───────────────────────────────────────────────────────
  const user = source.user;
  if (user) {
    const age = source.redact ? null : ageAt(user.date_of_birth, source.to);
    const rows: string[][] = [
      ['Пол', user.sex ?? '—'],
      ['Возраст', age === null ? '—' : `${age}`],
      ['Рост, см', fmtInt(user.body_height)],
      ['Вес на старте, кг', fmt(user.start_weight)],
      ['Цель', user.goal ?? '—'],
      ['Темп, кг/нед', fmt(user.weight_change_per_week, 2)],
      ['Коэффициент активности (PAL)', fmt(user.pal, 2)],
      [
        'Раскладка БЖУ, %',
        user.diet
          ? `У ${fmtInt(user.diet.carb_percentage)} / Б ${fmtInt(user.diet.protein_percentage)} / Ж ${fmtInt(user.diet.fat_percentage)}`
          : '—',
      ],
    ];
    push('## Профиль');
    push(table(['Показатель', 'Значение'], rows));
  }

  const goalStats = stats(series.map((p) => p.energyGoal).filter((v): v is number => v !== null));
  if (goalStats) {
    push('## Цель по калориям');
    push(
      `Средняя дневная цель: **${fmtInt(goalStats.mean)} ккал** ` +
        `(от ${fmtInt(goalStats.min)} до ${fmtInt(goalStats.max)}).`,
    );
  }

  // ── сводка периода ───────────────────────────────────────────────────────
  const energy = stats(withFood.map((p) => p.energy!));
  if (energy) {
    const carb = stats(withFood.map((p) => p.carb ?? 0));
    const protein = stats(withFood.map((p) => p.protein ?? 0));
    const fat = stats(withFood.map((p) => p.fat ?? 0));
    const fiber = stats(withFood.map((p) => p.fiber).filter((v): v is number => v !== null));

    // доля энергии из макроса: 4 ккал на грамм белка и углеводов, 9 — на грамм жира
    const share = (grams: number | undefined, perGram: number): string =>
      grams === undefined || energy.mean === 0 ? '—' : fmt(((grams * perGram) / energy.mean) * 100);

    push('## Сводка за период');
    push(
      table(
        ['Показатель', 'Среднее', 'Медиана', 'Минимум', 'Максимум', 'Доля энергии, %'],
        [
          ['Калории, ккал', fmtInt(energy.mean), fmtInt(energy.median), fmtInt(energy.min), fmtInt(energy.max), '100'],
          ['Углеводы, г', fmt(carb?.mean), fmt(carb?.median), fmt(carb?.min), fmt(carb?.max), share(carb?.mean, 4)],
          ['Белки, г', fmt(protein?.mean), fmt(protein?.median), fmt(protein?.min), fmt(protein?.max), share(protein?.mean, 4)],
          ['Жиры, г', fmt(fat?.mean), fmt(fat?.median), fmt(fat?.min), fmt(fat?.max), share(fat?.mean, 9)],
          ['Клетчатка, г', fmt(fiber?.mean), fmt(fiber?.median), fmt(fiber?.min), fmt(fiber?.max), '—'],
        ],
      ),
    );

    const withGoal = withFood.filter((p) => (p.energyGoal ?? 0) > 0);
    if (withGoal.length > 0) {
      const within = withGoal.filter((p) => Math.abs(p.energy! - p.energyGoal!) / p.energyGoal! <= 0.1);
      const over = withGoal.filter((p) => p.energy! > p.energyGoal!);
      const deficit =
        withGoal.reduce((sum, p) => sum + (p.energy! - p.energyGoal!), 0) / withGoal.length;

      push(
        `Дней в пределах ±10 % от цели: **${within.length} из ${withGoal.length}** ` +
          `(${fmt((within.length / withGoal.length) * 100)} %). ` +
          `Дней выше цели: ${over.length}. ` +
          `Среднее отклонение: **${deficit > 0 ? '+' : ''}${fmtInt(deficit)} ккал в день**.`,
      );
    }
  }

  // ── вес ──────────────────────────────────────────────────────────────────
  const weights = source.bodyValues
    .filter((value) => value.kind === 'weight')
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  if (weights.length > 0) {
    const first = weights[0];
    const last = weights.at(-1)!;
    const trend = weightTrend(source);
    push('## Вес');
    push(
      `Первое взвешивание: **${fmt(first.value)} кг** (${first.date}). ` +
        `Последнее: **${fmt(last.value)} кг** (${last.date}). ` +
        `Изменение: **${last.value - first.value > 0 ? '+' : ''}${fmt(last.value - first.value)} кг**` +
        (trend === null ? '.' : `, тренд **${trend > 0 ? '+' : ''}${fmt(trend, 2)} кг/нед**.`) +
        ` Всего взвешиваний: ${weights.length}.`,
    );
  }

  // ── активность ───────────────────────────────────────────────────────────
  const steps = stats(series.map((p) => p.steps).filter((v): v is number => v !== null));
  if (steps) {
    push('## Активность');
    push(
      `Шаги: в среднем **${fmtInt(steps.mean)}** в день ` +
        `(медиана ${fmtInt(steps.median)}, максимум ${fmtInt(steps.max)}), данные за ${steps.count} дн.`,
    );
  }

  // ── расход и баланс ──────────────────────────────────────────────────────
  if (source.health) {
    const spent = stats(series.map((p) => p.spent).filter((v): v is number => v !== null));
    const balance = stats(series.map((p) => p.balance).filter((v): v is number => v !== null));
    const sleep = stats(series.map((p) => p.asleep).filter((v): v is number => v !== null));
    const workouts = source.health.workouts;

    push('## Расход и баланс энергии');
    push(
      'Приход известен от YAZIO, расход — от Apple Health. Ни одно из двух приложений ' +
        'по отдельности баланса не показывает.',
    );

    if (spent && balance) {
      push(
        table(
          ['Показатель', 'Среднее', 'Медиана', 'Минимум', 'Максимум', 'Дней с данными'],
          [
            ['Потрачено за день, ккал', fmtInt(spent.mean), fmtInt(spent.median), fmtInt(spent.min), fmtInt(spent.max), String(spent.count)],
            ['Баланс (съедено − потрачено), ккал', fmtInt(balance.mean), fmtInt(balance.median), fmtInt(balance.min), fmtInt(balance.max), String(balance.count)],
          ],
        ),
      );
      push(
        `Отрицательный баланс — дефицит. Дней с дефицитом: ` +
          `**${series.filter((p) => p.balance !== null && p.balance < 0).length} из ${balance.count}**.`,
      );
    } else {
      push('Дней, где известны обе половины, в этом периоде нет.');
    }

    if (sleep) {
      push(
        `Сон: в среднем **${(sleep.mean / 60).toFixed(1)} ч** за ночь ` +
          `(медиана ${(sleep.median / 60).toFixed(1)} ч, минимум ${(sleep.min / 60).toFixed(1)}, ` +
          `максимум ${(sleep.max / 60).toFixed(1)}), ночей с данными: ${sleep.count}.`,
      );
    }

    if (workouts.length > 0) {
      const byType = new Map<string, { count: number; minutes: number; kcal: number }>();
      for (const workout of workouts) {
        const slot = byType.get(workout.type) ?? { count: 0, minutes: 0, kcal: 0 };
        slot.count++;
        slot.minutes += workout.durationMin;
        slot.kcal += workout.energyKcal ?? 0;
        byType.set(workout.type, slot);
      }

      const rows = [...byType.entries()]
        .sort(([, a], [, b]) => b.minutes - a.minutes)
        .slice(0, 15)
        .map(([type, slot]) => [
          type,
          String(slot.count),
          fmtInt(slot.minutes),
          fmtInt(slot.kcal),
          fmtInt(slot.minutes / slot.count),
        ]);

      push('### Тренировки');
      push(
        `Всего за период: **${workouts.length}**.`,
        '',
        table(['Вид', 'Раз', 'Всего минут', 'Всего ккал', 'Минут за раз'], rows),
      );
    }
  }

  // ── ряд по дням ──────────────────────────────────────────────────────────
  const points = granularity === 'day' ? series : collapse(series, granularity);
  const label = { day: 'Дата', week: 'Неделя с', month: 'Месяц' }[granularity];
  const note =
    granularity === 'day'
      ? ''
      : ` Значения усреднены по ${granularity === 'week' ? 'неделям' : 'месяцам'}: период слишком длинный для дневного ряда.`;

  push(`## Ряд по ${granularity === 'day' ? 'дням' : granularity === 'week' ? 'неделям' : 'месяцам'}`);
  push(
    `Пустая ячейка — данных за этот ${granularity === 'day' ? 'день' : 'период'} нет.${note}`,
    '',
    table(
      source.health
        ? [label, 'Ккал', 'Цель', 'Потрачено', 'Баланс', 'Углеводы', 'Белки', 'Жиры', 'Клетчатка', 'Шаги', 'Сон, ч', 'Вес']
        : [label, 'Ккал', 'Цель', 'Углеводы', 'Белки', 'Жиры', 'Клетчатка', 'Шаги', 'Вес'],
      points.map((point) => {
        const nutrition = [fmt(point.carb), fmt(point.protein), fmt(point.fat), fmt(point.fiber)];
        return source.health
          ? [
              point.date,
              fmtInt(point.energy),
              fmtInt(point.energyGoal),
              fmtInt(point.spent),
              fmtInt(point.balance),
              ...nutrition,
              fmtInt(point.steps),
              point.asleep === null ? '—' : fmt(point.asleep / 60),
              fmt(point.weight),
            ]
          : [
              point.date,
              fmtInt(point.energy),
              fmtInt(point.energyGoal),
              ...nutrition,
              fmtInt(point.steps),
              fmt(point.weight),
            ];
      }),
    ),
  );

  // ── приёмы пищи ──────────────────────────────────────────────────────────
  const byMeal = totalsBy(entries, (entry) => entry.meal);
  if (byMeal.size > 0) {
    const daysWithFood = Math.max(withFood.length, 1);
    const rows = [...byMeal.entries()]
      .map(([meal, slot]) => ({
        meal,
        energy: slot.nutrients.display('energy.energy') ?? 0,
        count: slot.count,
      }))
      .sort((a, b) => b.energy - a.energy)
      .map((row) => [
        MEALS[row.meal] ?? row.meal,
        fmtInt(row.energy / daysWithFood),
        fmt(row.count / daysWithFood, 1),
      ]);

    push('## Приёмы пищи');
    push(table(['Приём', 'Ккал в среднем за день', 'Записей за день'], rows));
  }

  // ── продукты ─────────────────────────────────────────────────────────────
  if (entries.length > 0) {
    const byProduct = totalsBy(entries, (entry) => entry.name);
    const top = [...byProduct.entries()]
      .map(([name, slot]) => ({
        name,
        energy: slot.nutrients.display('energy.energy') ?? 0,
        protein: slot.nutrients.display('nutrient.protein') ?? 0,
        count: slot.count,
      }))
      .sort((a, b) => b.energy - a.energy)
      .slice(0, 20);

    const totalEnergy = top.reduce((sum, row) => sum + row.energy, 0);
    push('## Что съедено чаще всего');
    push(
      table(
        ['Продукт', 'Записей', 'Всего ккал', 'Доля от топа, %', 'Белка, г'],
        top.map((row) => [
          row.name,
          String(row.count),
          fmtInt(row.energy),
          totalEnergy === 0 ? '—' : fmt((row.energy / totalEnergy) * 100),
          fmt(row.protein),
        ]),
      ),
    );
  }

  // ── микронутриенты ───────────────────────────────────────────────────────
  const perDay = totalsBy(entries, (entry) => entry.date);
  const daysWithEntries = perDay.size;
  if (daysWithEntries > 0) {
    const macros = new Set(['energy.energy', 'nutrient.carb', 'nutrient.protein', 'nutrient.fat']);
    const sums = new Map<number, { total: number; days: number }>();

    for (const { nutrients } of perDay.values()) {
      for (const index of nutrients.indices()) {
        if (macros.has(NUTRIENTS[index].apiKey)) continue;
        const slot = sums.get(index) ?? { total: 0, days: 0 };
        slot.total += (nutrients.get(index) ?? 0) * NUTRIENTS[index].factor;
        slot.days++;
        sums.set(index, slot);
      }
    }

    if (sums.size > 0) {
      const rows = [...sums.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, slot]) => [
          NUTRIENTS[index].column,
          fmt(slot.total / daysWithEntries, 3),
          `${fmtInt((slot.days / daysWithEntries) * 100)} %`,
        ]);

      push('## Микронутриенты');
      push(
        'Среднее за день по всем дням с записями и доля дней, где нутриент вообще фиксировался. ' +
          'Низкое покрытие означает, что среднее занижено: продукт мог содержать нутриент, но карточка о нём молчит.',
        '',
        table(['Нутриент', 'Среднее за день', 'Покрытие'], rows),
      );
    }
  }

  // ── качество данных ──────────────────────────────────────────────────────
  push('## Качество данных');
  if (warnings.length === 0) {
    push('Замечаний нет: суммы сходятся с итогами YAZIO, пропусков в периоде не обнаружено.');
  } else {
    push(
      table(
        ['Что', 'Где', 'Подробности'],
        warnings.slice(0, 50).map((warning) => [warning.phase, warning.key ?? '—', warning.message]),
      ),
    );
    if (warnings.length > 50) push(`…и ещё ${warnings.length - 50} замечаний.`);
  }

  return `${out.join('\n').trimEnd()}\n`;
}
