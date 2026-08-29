import { describe, expect, it } from 'vitest';

import { APPLE, emptyDay, makeSource } from '../../../../test/support/source';
import { buildTables } from '../build';
import type { ExportSource } from '../source';
import { renderMarkdown } from './markdown';

const OPTIONS = {
  toolVersion: '0.1.0',
  apiVersion: 'v9',
  account: 'основной',
  generatedAt: '2026-08-11 10:00:00',
};

const dayWith = (date: string, amount: number, steps?: number) =>
  emptyDay({
    consumed: {
      products: [
        { id: `e-${date}`, product_id: 'p-apple', date: `${date} 08:00:00`, daytime: 'breakfast', amount },
      ],
      recipe_portions: [],
      simple_products: [],
    } as never,
    exercises: steps === undefined ? null : ({ activity: { steps }, training: [], custom_training: [] } as never),
    goals: { 'energy.energy': 1900 },
  });

function sourceFor(days: string[], over: Partial<ExportSource> = {}): ExportSource {
  return makeSource({
    from: days[0],
    to: days.at(-1)!,
    products: new Map([['p-apple', APPLE as never]]),
    days: new Map(days.map((date, index) => [date, dayWith(date, 100 + index * 50, 7000 + index * 100)])),
    dailyNutrients: new Map(
      days.map((date, index) => [
        date,
        { energy: (100 + index * 50) * 0.52, carb: 0, protein: 0, fat: 0, energyGoal: 1900 },
      ]),
    ),
    user: {
      registration_date: '2026-01-01 07:00:00',
      sex: 'male',
      date_of_birth: '1984-01-12',
      body_height: 182,
      start_weight: 75,
      goal: 'lose',
      weight_change_per_week: -0.5,
      pal: 1.38,
      diet: { name: 'default', carb_percentage: 50, fat_percentage: 30, protein_percentage: 20 },
    } as never,
    bodyValues: [
      { kind: 'weight', loggedAt: `${days[0]} 07:00:00`, date: days[0], value: 75 },
      { kind: 'weight', loggedAt: `${days[Math.floor(days.length / 2)]} 07:00:00`, date: days[Math.floor(days.length / 2)], value: 74.2 },
      { kind: 'weight', loggedAt: `${days.at(-1)!} 07:00:00`, date: days.at(-1)!, value: 73.5 },
    ],
    ...over,
  });
}

const digestOf = (source: ExportSource, granularity: 'auto' | 'day' | 'week' | 'month' = 'auto'): string => {
  const built = buildTables(source, OPTIONS);
  return renderMarkdown(source, built.entries, built.meta, built.warnings, {
    granularity,
    accountLabel: 'основной',
  });
};

const range = (from: string, count: number): string[] => {
  const dates: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    dates.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
};

describe('Markdown-дайджест', () => {
  const days = range('2026-08-01', 5);

  it('начинается с периода и правил чтения', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toMatch(/^# Выгрузка YAZIO — основной/);
    expect(digest).toContain('2026-08-01 — 2026-08-05');
    expect(digest).toContain('## Как читать этот файл');
    // без этой оговорки модель прочитает пропуски как нули
    expect(digest).toContain('«не отслеживается»');
  });

  it('приводит профиль с возрастом на конец периода', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Профиль');
    expect(digest).toMatch(/\| Возраст \| 42 \|/);
    expect(digest).toMatch(/\| Рост, см \| 182 \|/);
  });

  it('считает средние, медиану и долю энергии из макросов', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Сводка за период');
    expect(digest).toMatch(/Калории, ккал \| \d+ \| \d+/);
  });

  it('говорит, сколько дней уложилось в цель', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toMatch(/Дней в пределах ±10 % от цели: \*\*\d+ из 5\*\*/);
  });

  it('показывает динамику веса и тренд', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Вес');
    expect(digest).toContain('Изменение: **-1.5 кг**');
    expect(digest).toMatch(/тренд \*\*-[\d.]+ кг\/нед\*\*/);
  });

  it('даёт строку на каждый день короткого периода', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Ряд по дням');
    for (const date of days) expect(digest).toContain(`| ${date} |`);
  });

  it('сворачивает длинный период в недели, чтобы файл влезал в контекст модели', () => {
    const long = range('2025-01-01', 500);
    const digest = digestOf(sourceFor(long));
    expect(digest).toContain('## Ряд по неделям');
    expect(digest).toContain('слишком длинный для дневного ряда');
    // 500 дней это 72 недели, а не 500 строк
    expect(digest.split('\n').filter((line) => /^\| 20\d\d-\d\d-\d\d \|/.test(line)).length).toBeLessThan(80);
  });

  it('слушается явно заданной гранулярности', () => {
    const digest = digestOf(sourceFor(days), 'month');
    expect(digest).toContain('## Ряд по месяцам');
    expect(digest).toContain('| 2026-08-01 |');
  });

  it('перечисляет приёмы пищи и продукты', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Приёмы пищи');
    expect(digest).toContain('завтрак');
    expect(digest).toContain('## Что съедено чаще всего');
    expect(digest).toContain('Яблоко');
  });

  it('приводит микронутриенты с покрытием', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Микронутриенты');
    expect(digest).toContain('potassium_mg');
    expect(digest).toMatch(/potassium_mg \| [\d.]+ \| 100 %/);
    // макросы уже разобраны в сводке, дублировать их здесь незачем
    expect(digest).not.toMatch(/\| carbs_g \|/);
  });

  it('на чистых данных прямо говорит, что замечаний нет', () => {
    const digest = digestOf(sourceFor(days));
    expect(digest).toContain('## Качество данных');
    expect(digest).toContain('Замечаний нет');
  });

  it('выносит расхождения в раздел качества', () => {
    const source = sourceFor(days);
    source.dailyNutrients.set('2026-08-01', { energy: 5000, carb: 0, protein: 0, fat: 0, energyGoal: 1900 });
    const digest = digestOf(source);
    expect(digest).toContain('Сверка');
    expect(digest).toContain('2026-08-01');
  });

  it('при обезличивании не пишет метку аккаунта в заголовок', () => {
    const digest = digestOf(sourceFor(days, { redact: true }));
    expect(digest).toMatch(/^# Выгрузка YAZIO\n/);
    expect(digest).not.toContain('основной');
    // возраст выводится из даты рождения, а она обезличена
    expect(digest).toMatch(/\| Возраст \| — \|/);
  });

  it('на пустом периоде не падает и честно показывает пустоту', () => {
    const empty = makeSource({ from: '2026-08-01', to: '2026-08-02' });
    const digest = digestOf(empty);
    expect(digest).toContain('Дней с записями о еде: **0**');
    expect(digest).toContain('## Ряд по дням');
  });
});
