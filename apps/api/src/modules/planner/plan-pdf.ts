import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import PDFDocument from 'pdfkit';

import {
  MEAL_TITLES,
  pickText,
  translate,
  translateMessage,
  unitLabel,
  workoutTitle,
  type Locale,
  type MacroSetDto,
  type PlanDayDto,
  type PlanDto,
} from '@fatoff/contracts';

/**
 * План одним файлом PDF.
 *
 * Макет свой, а не снимок страницы: гнать ради этого headless-браузер в образ —
 * триста мегабайт за одну кнопку. Текст берётся из общего словаря, тем же
 * `translate`, что и интерфейс, поэтому файл выходит на выбранном языке и не
 * расходится с экраном в формулировках.
 *
 * Лист читают не так, как экран: сюда нельзя навести мышь и негде развернуть
 * подсказку. Поэтому у каждого числа стоит подпись, «как читать» напечатано
 * прямо на первой странице, а день собран таблицей с шапкой, а не строкой из
 * значений через точку.
 *
 * Шрифты лежат рядом с кодом: у системных в контейнере кириллицы может не быть
 * вовсе, и вместо букв получатся квадраты — молча, уже в готовом файле.
 */
const FONTS = resolve(__dirname, '../../../assets/fonts');
const SANS = resolve(FONTS, 'Inter.ttf');
const MONO = resolve(FONTS, 'JetBrainsMono-Regular.ttf');
const MONO_BOLD = resolve(FONTS, 'JetBrainsMono-Bold.ttf');

const PAGE = { size: 'A4' as const, margin: 42 };
const INK = '#171922';
const MUTED = '#6b7285';
const LINE = '#e0e3ef';
const SUNK = '#f4f5fa';
const ACCENT = '#2f6fed';
const ALARM = '#b4553f';

/** Ширины колонок таблицы блюд: название тянется, числа стоят справа. */
const COL_AMOUNT = 86;
const COL_KCAL = 58;

export interface PlanPdfInput {
  plan: PlanDto;
  locale: Locale;
  /** Когда собран файл; передаётся, чтобы сборка была воспроизводимой в тестах. */
  generatedAt: Date;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function buildPlanPdf(input: PlanPdfInput): Promise<Buffer> {
  const { plan, locale } = input;
  const t: Translate = (key, params) => translate(locale, key, params);

  // дата сборки идёт и в метаданные: иначе pdfkit ставит туда «сейчас», и два
  // прогона на тех же данных дают разные байты — проверить нечем
  const doc = new PDFDocument({
    ...PAGE,
    bufferPages: true,
    info: { Title: plan.name, CreationDate: input.generatedAt },
  });
  registerFonts(doc);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolvePromise) => {
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
  });

  // ── шапка ────────────────────────────────────────────────────────────────
  doc.font('mono-bold').fontSize(9).fillColor(ACCENT).text('FATOFF');
  doc.moveDown(0.2);
  doc.font('sans').fontSize(20).fillColor(INK).text(plan.name);
  doc
    .font('mono')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${plan.from} — ${plan.to}   ·   ${plan.plan.summary.days} ${t('common.days')}`);
  if (plan.tags.length > 0) {
    doc.font('sans').fontSize(9).fillColor(MUTED).text(plan.tags.map((tag) => `#${tag}`).join('  '));
  }
  doc.moveDown(0.3);
  doc.font('sans').fontSize(9.5).fillColor(INK).text(t('pdf.lede'));
  doc.moveDown(0.7);

  // ── нормы ────────────────────────────────────────────────────────────────
  const targets = plan.plan.targets;
  section(doc, t('pdf.targets'));
  macroRow(doc, locale, targets.computed);
  doc
    .font('sans')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(translateMessage(locale, targets.basis.energy));
  doc.moveDown(0.6);

  // ── сводка ───────────────────────────────────────────────────────────────
  const summary = plan.plan.summary;
  section(doc, t('pdf.summary'));
  labelledRow(doc, [
    [t('pdf.avgPerDay'), `${summary.avgEnergyKcal} ${t('common.kcal')}`],
    [t('pdf.trainings'), `${summary.workouts}`],
    [t('common.min'), `${summary.trainingMinutes}`],
    [t('pdf.restDays'), `${summary.restDays}`],
  ]);
  doc.moveDown(0.6);

  // ── как читать ───────────────────────────────────────────────────────────
  section(doc, t('pdf.howToRead'));
  doc.font('sans').fontSize(8.5).fillColor(MUTED);
  for (const key of ['pdf.read.1', 'pdf.read.2', 'pdf.read.3']) {
    doc.text(`— ${t(key)}`, { paragraphGap: 1.5 });
  }
  // оговорка стоит здесь, а не в колонтитуле: там она не помещалась в строку и
  // наезжала на номер страницы
  doc.text(`— ${t('pdf.disclaimer')}`, { paragraphGap: 1.5 });
  doc.moveDown(0.5);

  if (plan.plan.warnings.length > 0) {
    section(doc, t('pdf.warnings'));
    doc.font('sans').fontSize(8.5).fillColor(MUTED);
    for (const warning of plan.plan.warnings) {
      doc.text(`— ${translateMessage(locale, warning)}`, { paragraphGap: 2 });
    }
    doc.moveDown(0.5);
  }

  // ── дни ──────────────────────────────────────────────────────────────────
  for (const day of plan.plan.days) {
    dayBlock(doc, locale, day, t);
  }

  footer(doc, locale, input.generatedAt);
  doc.end();
  return done;
}

function registerFonts(doc: PDFKit.PDFDocument): void {
  // без шрифта с кириллицей PDF выйдет из квадратов, и заметно это будет поздно
  for (const [name, path] of [
    ['sans', SANS],
    ['mono', MONO],
    ['mono-bold', MONO_BOLD],
  ] as const) {
    if (!existsSync(path)) throw new Error(`Не найден шрифт для PDF: ${path}`);
    doc.registerFont(name, path);
  }
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.3);
  doc.font('mono-bold').fontSize(8).fillColor(MUTED).text(title.toUpperCase());
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(pageRight(doc), y).strokeColor(LINE).stroke();
  doc.moveDown(0.5);
}

/** Числа с подписями под ними: на бумаге подписать надо каждое. */
function labelledRow(doc: PDFKit.PDFDocument, pairs: Array<[string, string]>): void {
  const width = (pageRight(doc) - doc.page.margins.left) / pairs.length;
  const top = doc.y;

  pairs.forEach(([label, value], index) => {
    const x = doc.page.margins.left + index * width;
    doc.font('mono-bold').fontSize(12).fillColor(INK);
    doc.text(value, x, top, { width, lineBreak: false });
    doc.font('sans').fontSize(7.5).fillColor(MUTED);
    doc.text(label, x, top + 15, { width, lineBreak: false });
  });

  doc.x = doc.page.margins.left;
  doc.y = top + 28;
}

function macroRow(doc: PDFKit.PDFDocument, locale: Locale, macros: MacroSetDto): void {
  const t = (key: string): string => translate(locale, key);
  labelledRow(doc, [
    [t('common.kcal'), `${macros.energyKcal ?? '—'}`],
    [t('macro.protein'), `${macros.proteinG ?? '—'}`],
    [t('macro.fat'), `${macros.fatG ?? '—'}`],
    [t('macro.carbs'), `${macros.carbsG ?? '—'}`],
    [t('macro.fiber'), `${macros.fiberG ?? '—'}`],
  ]);
}

/**
 * Хватит ли на странице места под кусок высотой `need`.
 *
 * Проверять надо до того, как что-то нарисовано: иначе заголовок дня остаётся
 * внизу одной страницы, а его меню начинается на следующей. Переносить с пустой
 * страницы нельзя — получится пустой лист.
 */
function ensureRoom(doc: PDFKit.PDFDocument, need: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  const atPageTop = doc.y <= doc.page.margins.top + 1;
  if (!atPageTop && doc.y + need > bottom) doc.addPage();
}

/** Подписи колонок таблицы блюд: на бумаге негде объяснить числа справа. */
function columnHead(doc: PDFKit.PDFDocument, t: Translate): void {
  const left = doc.page.margins.left;
  const top = doc.y;
  doc.font('sans').fontSize(7).fillColor(MUTED);
  doc.text(t('pdf.col.dish'), left + 10, top, { lineBreak: false });
  doc.text(t('pdf.col.amount'), pageRight(doc) - COL_AMOUNT - COL_KCAL, top, {
    width: COL_AMOUNT,
    align: 'right',
    lineBreak: false,
  });
  doc.text(t('pdf.col.kcal'), pageRight(doc) - COL_KCAL, top, {
    width: COL_KCAL,
    align: 'right',
    lineBreak: false,
  });
  doc.x = left;
  doc.y = top + 10;
  doc.moveTo(left, doc.y).lineTo(pageRight(doc), doc.y).strokeColor(LINE).stroke();
  doc.y += 4;
}

function dayBlock(doc: PDFKit.PDFDocument, locale: Locale, day: PlanDayDto, t: Translate): void {
  // заголовок дня и первый приём пищи не разлучаются
  ensureRoom(doc, 96);
  doc.moveDown(0.7);

  // ── полоса дня: дата, цель, меню, баланс ────────────────────────────────
  const left = doc.page.margins.left;
  const width = pageRight(doc) - left;
  const top = doc.y;
  doc.roundedRect(left, top, width, 34, 4).fillColor(SUNK).fill();

  doc.font('mono-bold').fontSize(12).fillColor(INK);
  doc.text(day.date, left + 8, top + 7, { lineBreak: false });
  doc.font('sans').fontSize(8).fillColor(MUTED);
  doc.text(t(`weekday.${day.weekday}`), left + 8, top + 22, { lineBreak: false });

  const cells: Array<[string, string, string]> = [
    [t('pdf.target'), `${day.targets.energyKcal ?? '—'}`, INK],
    [t('pdf.inMenu'), `${day.totals.energyKcal ?? '—'}`, INK],
    [
      t('pdf.balance'),
      `${signed(day.balanceKcal)} · ${t(`balance.${day.balance ?? 'even'}`)}`,
      day.balance === 'surplus' ? ALARM : INK,
    ],
  ];
  const cellWidth = (width - 100) / cells.length;
  cells.forEach(([label, value, color], index) => {
    const x = left + 100 + index * cellWidth;
    doc.font('mono-bold').fontSize(10).fillColor(color);
    doc.text(value, x, top + 6, { width: cellWidth - 6, lineBreak: false });
    doc.font('sans').fontSize(7.5).fillColor(MUTED);
    doc.text(label, x, top + 21, { width: cellWidth - 6, lineBreak: false });
  });

  doc.x = left;
  doc.y = top + 40;

  // ── тренировки ──────────────────────────────────────────────────────────
  doc.font('sans').fontSize(8.5).fillColor(MUTED);
  doc.text(
    day.workouts.length === 0
      ? t('pdf.rest')
      : `${t('pdf.workouts')}: ` +
          day.workouts
            .map(
              (workout) =>
                `${pickText(locale, workoutTitle(workout.type))} ${workout.durationMin} ${t('common.min')} · ${workout.energyKcal} ${t('common.kcal')}`,
            )
            .join('   ·   '),
  );
  doc.moveDown(0.35);

  // шапка колонок — одна на день: над каждым приёмом она превращалась в шум
  columnHead(doc, t);

  // ── приёмы пищи таблицей ────────────────────────────────────────────────
  for (const meal of day.meals) {
    ensureRoom(doc, 30 + meal.items.length * 13);

    doc
      .font('mono-bold')
      .fontSize(9.5)
      .fillColor(INK)
      .text(
        `${pickText(locale, MEAL_TITLES[meal.meal])}   ${meal.totals.energyKcal ?? '—'} ${t('pdf.of')} ${meal.targetKcal} ${t('common.kcal')}`,
        left,
        doc.y,
      );
    doc.y += 2;

    for (const item of meal.items) {
      const rowTop = doc.y;
      doc.font('sans').fontSize(9).fillColor(INK);
      doc.text(item.name, left + 10, rowTop, {
        width: pageRight(doc) - left - COL_AMOUNT - COL_KCAL - 20,
        lineBreak: false,
        ellipsis: true,
      });
      doc.font('mono').fontSize(8.5).fillColor(MUTED);
      doc.text(
        `${item.amount} ${unitLabel(locale, item.unit)}`,
        pageRight(doc) - COL_AMOUNT - COL_KCAL,
        rowTop,
        { width: COL_AMOUNT, align: 'right', lineBreak: false },
      );
      doc.font('mono').fontSize(8.5).fillColor(INK);
      doc.text(`${item.energyKcal}`, pageRight(doc) - COL_KCAL, rowTop, {
        width: COL_KCAL,
        align: 'right',
        lineBreak: false,
      });
      doc.x = left;
      doc.y = rowTop + 12;
    }

    doc.font('mono').fontSize(7.5).fillColor(MUTED);
    doc.text(
      `   ${t('macro.protein.letter')} ${meal.totals.proteinG} · ${t('macro.fat.letter')} ${meal.totals.fatG} · ` +
        `${t('macro.carbs.letter')} ${meal.totals.carbsG} · ${t('macro.fiber.letter')} ${meal.totals.fiberG}`,
      left + 10,
      doc.y,
    );
    doc.x = left;
    doc.moveDown(0.4);
  }

  // ── итог дня ────────────────────────────────────────────────────────────
  doc.font('mono').fontSize(8).fillColor(MUTED);
  doc.text(
    `${t('pdf.dayTotal')}:   ${day.totals.energyKcal ?? '—'} ${t('common.kcal')}   ·   ` +
      `${t('macro.protein.letter')} ${day.totals.proteinG} · ${t('macro.fat.letter')} ${day.totals.fatG} · ` +
      `${t('macro.carbs.letter')} ${day.totals.carbsG} · ${t('macro.fiber.letter')} ${day.totals.fiberG}` +
      `   ·   ${t('pdf.burn')} ${day.burnKcal ?? '—'} ${t('common.kcal')}`,
    left + 10,
    doc.y,
  );
  doc.x = left;

  if (day.warnings.length > 0) {
    doc.font('sans').fontSize(8).fillColor(ALARM);
    for (const warning of day.warnings) {
      doc.text(`! ${translateMessage(locale, warning)}`, left + 10, doc.y);
    }
    doc.x = left;
  }
}

function footer(doc: PDFKit.PDFDocument, locale: Locale, generatedAt: Date): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);

    /*
     * Подпись стоит ниже нижнего поля, а запись за полем заставляет pdfkit
     * добавить страницу — и в конце файла появлялся пустой лист. Поле на время
     * подписи убирается, потом возвращается на место.
     */
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - bottom + 12;
    const numberWidth = 70;
    doc.font('mono').fontSize(7.5).fillColor(MUTED);
    doc.text(
      translate(locale, 'pdf.generated', { date: generatedAt.toISOString().slice(0, 10) }),
      doc.page.margins.left,
      y,
      {
        width: pageRight(doc) - doc.page.margins.left - numberWidth - 10,
        lineBreak: false,
        ellipsis: true,
      },
    );
    doc.text(translate(locale, 'pdf.page', { page: index + 1 }), pageRight(doc) - numberWidth, y, {
      width: numberWidth,
      align: 'right',
      lineBreak: false,
    });

    doc.page.margins.bottom = bottom;
  }
}

const pageRight = (doc: PDFKit.PDFDocument): number => doc.page.width - doc.page.margins.right;

const signed = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value}`;
