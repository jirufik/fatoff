import type { TemplateDto } from '@fatoff/contracts';

/**
 * Встроенные наборы настроек под понятные задачи.
 *
 * Живут в коде, а не в базе: это часть поставки, их не редактируют, и миграция
 * под них не нужна. Свои наборы человек сохраняет отдельно, и они приходят в
 * том же списке.
 *
 * Ни один из них не трогает режим тренировок. Раньше трогали — и получалось,
 * что «По нормам ВОЗ» есть и в наборах, и отдельной карточкой среди режимов:
 * два разных на вид способа сделать одно и то же. Режим выбирается карточкой,
 * набор меняет всё остальное.
 *
 * Период набор тоже не задаёт: он говорит «как», а не «когда».
 */
export const BUILTIN_TEMPLATES: TemplateDto[] = [
  {
    id: 'builtin:gentle',
    name: {"ru": "Мягкий темп", "en": "Gentle pace"},
    description: {"ru": "Снижение 0.4 % массы в неделю вместо 0.65 — дефицит меньше, энергодоступность выше. Дольше по времени, но безжировая масса при таком темпе сохраняется лучше.", "en": "Losing 0.4 % of body weight a week instead of 0.65 — a smaller deficit and higher energy availability. It takes longer, but lean mass holds up better at that pace."},
    builtin: true,
    settings: { targets: { lossRatePctPerWeek: 0.4 } },
    createdAt: null,
  },
  {
    id: 'builtin:fiber',
    name: {"ru": "Упор на клетчатку", "en": "Fibre first"},
    description: {"ru": "Норма клетчатки поднята до 16 г на 1000 ккал, а её вес в подборе — вчетверо. Ради самого заметного разрыва в нынешнем питании: 8 граммов против двадцати нужных.", "en": "The fibre target is raised to 16 g per 1000 kcal and its weight in the selection is quadrupled. For the widest gap in her current eating: 8 grams against the twenty needed."},
    builtin: true,
    settings: {
      targets: { fiberPer1000Kcal: 16 },
      algorithm: { weights: { energy: 3, protein: 3, carbs: 1, fat: 1, fiber: 4, items: 0.5, repeat: 2 } },
    },
    createdAt: null,
  },
  {
    id: 'builtin:simple',
    name: {"ru": "Проще готовить", "en": "Simpler to cook"},
    description: {"ru": "Три позиции в приёме вместо четырёх и до пяти повторов в неделю. Меню однообразнее, зато список покупок короче и выполнить его реально в будни.", "en": "Three items per meal instead of four and up to five repeats a week. The menu is plainer, but the shopping list is shorter and the plan survives a weekday."},
    builtin: true,
    settings: {
      algorithm: {
        maxItemsPerMeal: 3,
        maxRepeats: 5,
        weights: { energy: 3, protein: 3, carbs: 1, fat: 1, fiber: 1, items: 1.5, repeat: 0.5 },
      },
    },
    createdAt: null,
  },
  {
    id: 'builtin:three-meals',
    name: {"ru": "Три приёма без перекуса", "en": "Three meals, no snack"},
    description: {"ru": "Завтрак, обед и ужин, доли перераспределены между ними. Каждый приём крупнее, и порог белка в 0.4 г/кг набирается проще, чем при четырёх.", "en": "Breakfast, lunch and dinner with the shares redistributed between them. Each meal is larger, and the 0.4 g/kg protein floor is easier to reach than across four."},
    builtin: true,
    settings: { meals: ['breakfast', 'lunch', 'dinner'] },
    createdAt: null,
  },
];
