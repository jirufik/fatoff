import type { DiaryEntry } from './tables/diary';
import { totalsBy } from './tables/diary';
import type { BuildWarning, ExportSource } from './source';

/** Порог расхождения: полпроцента дневной энергии, но не меньше килокалории. */
const TOLERANCE_RATIO = 0.005;
const TOLERANCE_MIN = 1;

/** Сколько расхождений выписывать поимённо, прежде чем свернуть в одну строку. */
const LISTED = 10;

/**
 * Сверка собственной арифметики с дневными итогами YAZIO.
 *
 * Самая дешёвая проверка того, что вся выгрузка верна: если продукт умножен не
 * на то, рецепт прочитан не так или запрос молча провалился — день, где это
 * случилось, перестаёт сходиться.
 *
 * Единичные расхождения нормальны и починить их нельзя: YAZIO хранит итоги
 * такими, какими они были в момент записи, а мы пересчитываем по нынешней
 * карточке продукта. Стена расхождений означает, что сломалось что-то ещё.
 */
export function reconcile(
  source: ExportSource,
  entries: DiaryEntry[],
  warnings: BuildWarning[],
): void {
  const computed = totalsBy(entries, (entry) => entry.date);
  let off = 0;

  for (const [date, totals] of [...source.dailyNutrients.entries()].sort()) {
    if (date < source.from || date > source.to) continue;
    // день, который не выгружали, сверять не с чем — это пропуск, а не расхождение
    if (!source.days.get(date)?.consumed) continue;

    const ours = computed.get(date)?.nutrients.display('energy.energy') ?? 0;
    const residual = totals.energy - ours;
    const tolerance = Math.max(Math.abs(totals.energy) * TOLERANCE_RATIO, TOLERANCE_MIN);
    if (Math.abs(residual) <= tolerance) continue;

    off++;
    if (off <= LISTED) {
      warnings.push({
        phase: 'Сверка',
        key: date,
        message:
          `посчитано ${ours.toFixed(1)} ккал против ${totals.energy.toFixed(1)} у YAZIO ` +
          `(${residual > 0 ? '+' : ''}${residual.toFixed(1)})`,
      });
    }
  }

  if (off > LISTED) {
    warnings.push({
      phase: 'Сверка',
      key: null,
      message: `дней с расхождением: ${off}; поимённо перечислены первые ${LISTED}`,
    });
  }
}
