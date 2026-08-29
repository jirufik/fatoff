import type { Dataset, Text } from './common.js';

/**
 * Что в каком поле лежит — и в просмотре, и в выгружаемых файлах.
 *
 * Живёт в общем пакете, потому что нужен интерфейсу; полнота описания
 * проверяется тестом, который сравнивает справочник с колонками, которые
 * действительно строит выгрузка. Иначе документация начинает врать первой же
 * правкой таблицы.
 */

export interface FieldDoc {
  /** Имя колонки как оно в файле. */
  name: string;
  title: Text;
  /** Что именно там лежит и в чём измеряется. */
  note?: Text;
}

export interface TableDoc {
  name: string;
  title: Text;
  /** Что означает одна строка. */
  row: Text;
  note?: Text;
  /** Срез выгрузки, который приносит эту таблицу. */
  dataset?: Dataset;
  fields: FieldDoc[];
  /**
   * К базовым колонкам добавляются колонки нутриентов — только те, что
   * действительно встретились в данных. Полный их список — в реестре нутриентов.
   */
  nutrients?: 'all' | 'except-macros';
}

/** Двуязычная строка — короткой записью, иначе справочник не прочитать. */
const t = (ru: string, en: string): Text => ({ ru, en });

/** Строка, одинаковая на обоих языках: перечень значений поля. */
const same = (value: string): Text => ({ ru: value, en: value });

const f = (name: string, title: Text, note?: Text): FieldDoc => ({ name, title, note });

/** Правила чтения, общие для всех таблиц и форматов. */
export const READING_RULES: Text[] = [
  t('Энергия — в килокалориях, даже если в приложении выбраны килоджоули. Масса — в граммах, если в имени колонки не сказано иначе: `_mg` — миллиграммы, `_ug` — микрограммы.', 'Energy is in kilocalories even if the app is set to kilojoules. Mass is in grams unless the column name says otherwise: `_mg` — milligrams, `_ug` — micrograms.'),
  t('Пустое значение означает «не отслеживается», а не ноль. YAZIO не присылает нутриент, о котором ничего не знает, поэтому пустая ячейка и ноль — разные вещи. В JSON и TOON они различаются, в CSV обе выглядят пустым полем.', 'An empty value means "not tracked", not zero. YAZIO does not send a nutrient it knows nothing about, so a blank cell and a zero are different things. JSON and TOON keep them apart; in CSV both look like an empty field.'),
  t('В `nutrition_log` нутриенты уже умножены на съеденное количество. В `products` они остаются такими, как их отдаёт YAZIO — **на одну базовую единицу** (грамм или миллилитр), а не на 100 грамм: оливковое масло читается как 8.22 ккал.', 'In `nutrition_log` the nutrients are already multiplied by the amount eaten. In `products` they stay exactly as YAZIO returns them — **per one base unit** (gram or millilitre), not per 100 grams: olive oil reads as 8.22 kcal.'),
  t('В `recipes` нутриенты приведены **на одну порцию**, а не на весь рецепт.', 'In `recipes` the nutrients are given **per portion**, not for the whole recipe.'),
  t('Дневные итоги по калориям и БЖУ в `daily_summary` взяты у YAZIO как есть; остальные нутриенты досчитаны по карточкам продуктов.', 'Daily totals for calories and macros in `daily_summary` are taken from YAZIO as is; the other nutrients are computed from the product cards.'),
  t('Таблицы соединяются по `date`, `product_id` и `recipe_id`.', 'Tables join on `date`, `product_id` and `recipe_id`.'),
  t('Данные Apple Health сведены по дням, и на каждый день с показателем взят один источник: часы и телефон измеряют независимо, складывать их нельзя. Питание из Apple Health не используется — туда его пишет сам YAZIO.', 'Apple Health data is rolled up by day, and for each day and metric a single source is used: the watch and the phone measure independently, so they must not be summed. Nutrition from Apple Health is ignored — YAZIO itself writes it there.'),
];

/** Колонки таблиц просмотра в интерфейсе. */
export const BROWSE_TABLES: TableDoc[] = [
  {
    name: 'diary',
    title: t('Дневник', 'Diary'),
    row: t('одна запись о съеденном', 'one entry of something eaten'),
    note: t('Разворачивается из сырых ответов YAZIO при каждом запросе; отдельной таблицы под неё в базе нет.', 'Unpacked from the raw YAZIO responses on every request; there is no separate table for it in the database.'),
    fields: [
      f('date', t('Дата', 'Date'), t('День дневника, `YYYY-MM-DD`', 'Diary day, `YYYY-MM-DD`')),
      f('logged_at', t('Записано', 'Logged at'), t('Когда запись сделана; у YAZIO это полная отметка времени', 'When the entry was made; YAZIO stores a full timestamp')),
      f('meal', t('Приём пищи', 'Meal'), same('breakfast, lunch, dinner, snack')),
      f('kind', t('Вид записи', 'Entry kind'), t('product — продукт из базы, recipe_portion — порции рецепта, simple_product — быстрая запись', 'product — an item from the database, recipe_portion — recipe portions, simple_product — a quick entry')),
      f('name', t('Название', 'Name'), t('Из карточки продукта; `Unknown (id)` — карточка не выгрузилась, сама запись при этом цела', 'From the product card; `Unknown (id)` means the card did not sync, though the entry itself is intact')),
      f('producer', t('Производитель', 'Producer'), t('Только у продуктов из базы', 'Only for items from the database')),
      f('amount', t('Количество', 'Amount'), t('В базовых единицах продукта; у порций рецепта — число порций; у быстрой записи пусто, потому что количества у неё нет', 'In the product base units; for recipe portions — the number of portions; empty for a quick entry, which has no amount')),
      f('serving', t('Порция', 'Serving'), t('Как отмерено: gram, piece, tablespoon…', 'How it was measured: gram, piece, tablespoon…')),
      f('energy_kcal', t('Ккал', 'Kcal'), t('Итог по этой записи, умножение уже сделано', 'Total for this entry, already multiplied')),
      f('carbs_g', t('Углеводы, г', 'Carbs, g'), t('Итог по записи', 'Total for the entry')),
      f('protein_g', t('Белки, г', 'Protein, g'), t('Итог по записи', 'Total for the entry')),
      f('fat_g', t('Жиры, г', 'Fat, g'), t('Итог по записи', 'Total for the entry')),
    ],
  },
  {
    name: 'days',
    title: t('По дням', 'By day'),
    row: t('один выгруженный день', 'one synced day'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('entries', t('Записей', 'Entries'), t('Сколько позиций записано в дневник за день', 'How many items were logged that day')),
      f('energy_kcal', t('Ккал', 'Kcal'), t('Дневной итог, посчитанный самим YAZIO', 'Daily total as computed by YAZIO itself')),
      f('energy_goal_kcal', t('Цель, ккал', 'Goal, kcal'), t('Дневная цель по калориям на тот день', 'The calorie goal for that day')),
      f('carbs_g / protein_g / fat_g', t('БЖУ', 'Macros'), t('Дневные итоги YAZIO', 'YAZIO daily totals')),
      f('steps', t('Шаги', 'Steps'), t('Из диапазонного ответа об активности', 'From the ranged activity response')),
      f('water_ml', t('Вода, мл', 'Water, ml'), t('Пусто — воду в этот день не спрашивали; ноль — спрашивали и не пили', 'Empty — water was not tracked that day; zero — it was tracked and none was drunk')),
      f('weight_kg', t('Вес, кг', 'Weight, kg'), t('Последнее взвешивание за этот день', 'The last weigh-in of that day')),
    ],
  },
  {
    name: 'products',
    title: t('Продукты', 'Products'),
    row: t('одна карточка продукта в кэше', 'one cached product card'),
    note: t('Кэш заполняется по мере того, как продукты встречаются в дневнике.', 'The cache fills as products show up in the diary.'),
    fields: [
      f('name', t('Название', 'Name')),
      f('producer', t('Производитель', 'Producer')),
      f('category', t('Категория', 'Category'), t('Как её называет YAZIO', 'As YAZIO names it')),
      f('base_unit', t('Базовая единица', 'Base unit'), t('g или ml — то, к чему отнесены нутриенты карточки', 'g or ml — what the card nutrients refer to')),
      f('energy_per_unit', t('Ккал на единицу', 'Kcal per unit'), t('**На одну базовую единицу**, не на 100 грамм', '**Per one base unit**, not per 100 grams')),
      f('entries', t('Записей', 'Entries'), t('Сколько раз продукт встречается в дневнике', 'How many times the product appears in the diary')),
      f('total_energy_kcal', t('Всего ккал', 'Total kcal'), t('Сколько энергии этот продукт дал за всё время', 'How much energy this product supplied over all time')),
      f('last_used', t('Последний раз', 'Last seen'), t('Дата последней записи с этим продуктом', 'Date of the last entry with this product')),
    ],
  },
  {
    name: 'health',
    title: t('Здоровье', 'Health'),
    row: t('один день по данным Apple Health', 'one day of Apple Health data'),
    note: t('На каждый день и показатель взят **один источник** — тот, что дал больше. Часы и телефон считают шаги независимо, и складывать их нельзя.', 'For each day and metric a **single source** is used — whichever reported more. The watch and the phone count steps independently and must not be summed.'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('steps', t('Шаги', 'Steps')),
      f('active_kcal', t('Активные ккал', 'Active kcal'), t('Потрачено сверх основного обмена', 'Spent on top of the basal metabolism')),
      f('basal_kcal', t('Базальные ккал', 'Basal kcal'), t('Основной обмен за день', 'Basal metabolism for the day')),
      f('exercise_min', t('Минуты упражнений', 'Exercise minutes'), t('Кольцо «Упражнения» на часах', 'The Exercise ring on the watch')),
      f('stand_hours', t('Часов стоя', 'Stand hours'), t('Сколько часов за день засчитано как «стоя»', 'How many hours of the day counted as standing')),
      f('distance_km', t('Дистанция, км', 'Distance, km'), t('Ходьба и бег', 'Walking and running')),
      f('flights', t('Этажей', 'Flights'), t('Пролётов лестницы', 'Flights of stairs')),
      f('resting_hr', t('Пульс покоя', 'Resting heart rate')),
      f('heart_rate_avg', t('Средний пульс', 'Average heart rate'), t('По всем замерам за день', 'Across all readings of the day')),
      f('hrv_ms', t('Вариабельность пульса, мс', 'Heart rate variability, ms'), t('SDNN — показатель восстановления', 'SDNN — a recovery marker')),
      f('respiratory_rate', t('Частота дыхания', 'Respiratory rate')),
      f('oxygen_saturation', t('Кислород в крови', 'Blood oxygen'), t('Доля от единицы: 0.97 — это 97 %', 'A fraction of one: 0.97 means 97 %')),
      f('asleep_min', t('Сон, мин', 'Sleep, min'), t('Из ночи, помеченной этой датой', 'From the night labelled with this date')),
      f('deep_min / rem_min', t('Глубокий сон и REM, мин', 'Deep sleep and REM, min')),
      f('weight_kg', t('Вес, кг', 'Weight, kg'), t('Последнее взвешивание за день по данным Health', 'The last weigh-in of the day according to Health')),
    ],
  },
  {
    name: 'workouts',
    title: t('Тренировки', 'Workouts'),
    row: t('одна тренировка из Apple Health', 'one Apple Health workout'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('started_at', t('Начало', 'Start')),
      f('type', t('Вид', 'Kind'), same('Walking, Running, Cycling, TraditionalStrengthTraining…')),
      f('duration_min', t('Длительность, мин', 'Duration, min')),
      f('energy_kcal', t('Сожжено, ккал', 'Burned, kcal'), t('Активные калории тренировки', 'Active calories of the workout')),
      f('distance_km', t('Дистанция, км', 'Distance, km'), t('Только там, где она измеряется', 'Only where it is measured')),
      f('source', t('Источник', 'Source'), t('Часы, телефон или приложение', 'Watch, phone or app')),
    ],
  },
  {
    name: 'sleep',
    title: t('Сон', 'Sleep'),
    row: t('одна ночь по одному источнику', 'one night from one source'),
    note: t('Ночь помечена датой **пробуждения**: сон с 23:41 до 07:12 попадает на то утро, когда человек проснулся.', 'A night is labelled with the **wake-up** date: sleep from 23:41 to 07:12 lands on the morning the person woke up.'),
    fields: [
      f('night', t('Ночь', 'Night'), t('Дата пробуждения', 'Wake-up date')),
      f('source', t('Источник', 'Source')),
      f('in_bed_min', t('В постели, мин', 'In bed, min'), t('Не всякий источник это пишет', 'Not every source records it')),
      f('asleep_min', t('Всего сна, мин', 'Total sleep, min'), t('Сумма стадий сна, без «в постели» и «бодрствования»', 'The sum of sleep stages, excluding in-bed and awake')),
      f('deep_min', t('Глубокий сон, мин', 'Deep sleep, min')),
      f('rem_min', t('REM, мин', 'REM, min')),
      f('core_min', t('Основной сон, мин', 'Core sleep, min')),
      f('awake_min', t('Бодрствование, мин', 'Awake, min'), t('Пробуждения посреди ночи', 'Wake-ups in the middle of the night')),
      f('fell_asleep_at / woke_at', t('Границы ночи', 'Night boundaries')),
    ],
  },
  {
    name: 'measurements',
    title: t('Замеры', 'Measurements'),
    row: t('один замер тела', 'one body measurement'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('logged_at', t('Отметка времени', 'Timestamp'), t('За день замеров может быть несколько', 'There can be several measurements a day')),
      f('kind', t('Вид', 'Kind'), same('weight, body_fat, muscle_ratio, waist, hip, chest')),
      f('value', t('Значение', 'Value'), t('Вес — в килограммах, доли — в процентах, обхваты — в сантиметрах', 'Weight in kilograms, fractions in per cent, circumferences in centimetres')),
    ],
  },
];

/** Таблицы выгружаемых файлов. */
export const EXPORT_TABLES: TableDoc[] = [
  {
    name: 'meta',
    title: t('О выгрузке', 'About the export'),
    row: t('вся выгрузка, одна строка', 'the whole export, one row'),
    fields: [
      f('tool_version', t('Версия сервиса', 'Service version')),
      f('api_version', t('Версия API YAZIO', 'YAZIO API version'), t('Путь, по которому забирались данные', 'The path the data was fetched through')),
      f('account', t('Аккаунт', 'Account'), t('Пусто при обезличивании', 'Empty when redacted')),
      f('from / to', t('Период', 'Period')),
      f('generated_at', t('Когда собрано', 'Built at')),
      f('days_with_data', t('Дней с данными', 'Days with data')),
      f('entries', t('Записей дневника', 'Diary entries')),
      f('products / recipes', t('Карточек в выгрузке', 'Cards in the export')),
      f('warnings', t('Замечаний', 'Warnings'), t('Столько же строк в таблице warnings', 'The same number of rows as in the warnings table')),
    ],
  },
  {
    name: 'tables',
    title: t('Опись', 'Manifest'),
    row: t('одна таблица выгрузки', 'one export table'),
    note: t('Нужна затем, что пустая таблица в JSON выглядит как `[]`, а в TOON как `name: []` — список колонок в обоих случаях теряется. Здесь он сохраняется.', 'It exists because an empty table looks like `[]` in JSON and `name: []` in TOON — the column list is lost either way. Here it is kept.'),
    fields: [
      f('name', t('Имя таблицы', 'Table name')),
      f('rows', t('Строк', 'Rows')),
      f('columns', t('Колонки', 'Columns'), t('Перечислены через `;` в том порядке, в каком идут в файле', 'Listed with `;` in the order they appear in the file')),
    ],
  },
  {
    name: 'nutrition_log',
    title: t('Дневник питания', 'Nutrition log'),
    row: t('одна запись о съеденном', 'one entry of something eaten'),
    dataset: 'diary',
    nutrients: 'all',
    fields: [
      f('date', t('Дата дня', 'Day date')),
      f('logged_at', t('Отметка времени записи', 'Entry timestamp')),
      f('meal', t('Приём пищи', 'Meal'), same('breakfast, lunch, dinner, snack')),
      f('entry_id', t('Идентификатор записи', 'Entry id'), t('По нему YAZIO различает записи внутри дня', 'YAZIO tells entries within a day apart by it')),
      f('source_id', t('Продукт или рецепт', 'Product or recipe'), t('Соединяется с `products.product_id` или `recipes.recipe_id`; у быстрой записи пусто', 'Joins `products.product_id` or `recipes.recipe_id`; empty for a quick entry')),
      f('product', t('Название', 'Name')),
      f('producer', t('Производитель', 'Producer')),
      f('type', t('Вид записи', 'Entry kind'), same('product, recipe_portion, simple_product')),
      f('amount', t('Количество', 'Amount'), t('В базовых единицах; у рецепта — порции; у быстрой записи пусто', 'In base units; for a recipe — portions; empty for a quick entry')),
      f('serving', t('Порция', 'Serving'), t('Как отмерено', 'How it was measured')),
      f('serving_quantity', t('Порций', 'Portions'), t('Сколько таких порций', 'How many such portions')),
      f('ai_generated', t('Оценено ИИ', 'AI estimated'), t('Только у быстрых записей: приложение само прикинуло нутриенты', 'Quick entries only: the app estimated the nutrients itself')),
    ],
  },
  {
    name: 'daily_summary',
    title: t('Итоги по дням', 'Daily summary'),
    row: t('каждый день периода, даже пустой', 'every day of the period, even an empty one'),
    dataset: 'diary',
    nutrients: 'except-macros',
    note: t('Строка есть на каждую дату периода: день, где нет еды, но есть шаги или вес, иначе исчез бы из выгрузки.', 'There is a row for every date of the period: a day with no food but with steps or a weigh-in would otherwise vanish from the export.'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('energy_kcal', t('Ккал', 'Kcal'), t('Итог YAZIO', 'YAZIO total')),
      f('energy_goal_kcal', t('Цель, ккал', 'Goal, kcal')),
      f('carbs_g / protein_g / fat_g', t('БЖУ', 'Macros'), t('Итоги YAZIO', 'YAZIO totals')),
      f('steps', t('Шаги', 'Steps')),
      f('activity_energy_kcal', t('Активные ккал', 'Active kcal')),
      f('water_ml', t('Вода, мл', 'Water, ml')),
    ],
  },
  {
    name: 'meal_summary',
    title: t('Итоги по приёмам пищи', 'Meal summary'),
    row: t('день × приём пищи', 'day × meal'),
    dataset: 'diary',
    nutrients: 'all',
    fields: [
      f('date', t('Дата', 'Date')),
      f('meal', t('Приём пищи', 'Meal')),
      f('entry_count', t('Записей', 'Entries'), t('Сколько позиций в этом приёме', 'How many items in this meal')),
    ],
  },
  {
    name: 'daily_goals',
    title: t('Цели по дням', 'Daily goals'),
    row: t('день × вариант цели', 'day × goal variant'),
    dataset: 'goals',
    fields: [
      f('date', t('Дата', 'Date')),
      f('variant', t('Вариант', 'Variant'), t('effective — по чему считался день; unmodified — что предлагал YAZIO до ручных правок', 'effective — what the day was counted against; unmodified — what YAZIO suggested before manual edits')),
      f('energy_kcal', t('Цель по калориям', 'Calorie goal')),
      f('carbs_g / protein_g / fat_g', t('Цели по БЖУ, г', 'Macro goals, g')),
      f('water_ml', t('Цель по воде, мл', 'Water goal, ml')),
      f('steps', t('Цель по шагам', 'Step goal')),
      f('weight_kg', t('Целевой вес, кг', 'Goal weight, kg')),
    ],
  },
  {
    name: 'daily_activity',
    title: t('Активность по дням', 'Daily activity'),
    row: t('один день с активностью', 'one day with activity'),
    dataset: 'activity',
    note: t('Шаги, длительность и энергия берутся из диапазонного ответа — он дешевле и авторитетнее; дистанция и происхождение есть только в дневном.', 'Steps, duration and energy come from the ranged response — it is cheaper and more authoritative; distance and origin exist only in the daily one.'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('steps', t('Шаги', 'Steps')),
      f('activity_energy_kcal', t('Активные ккал', 'Active kcal')),
      f('distance_m', t('Дистанция, м', 'Distance, m')),
      f('duration_min', t('Длительность, мин', 'Duration, min')),
      f('source', t('Источник', 'Source'), t('Откуда пришли данные: health_kit, google_fit…', 'Where the data came from: health_kit, google_fit…')),
      f('gateway', t('Шлюз', 'Gateway'), t('Через что переданы', 'What it was passed through')),
    ],
  },
  {
    name: 'exercises',
    title: t('Тренировки', 'Workouts'),
    row: t('одна залогированная тренировка', 'one logged workout'),
    dataset: 'activity',
    fields: [
      f('date', t('Дата', 'Date')),
      f('kind', t('Вид', 'Kind'), t('training — из справочника YAZIO, custom_training — своя', 'training — from the YAZIO catalogue, custom_training — a custom one')),
      f('exercise_id', t('Идентификатор', 'Id')),
      f('name', t('Название', 'Name')),
      f('note', t('Заметка', 'Note')),
      f('energy_kcal', t('Сожжено, ккал', 'Burned, kcal')),
      f('duration_min', t('Длительность, мин', 'Duration, min')),
      f('distance_m', t('Дистанция, м', 'Distance, m')),
      f('steps', t('Шаги', 'Steps')),
      f('source / gateway', t('Происхождение', 'Origin')),
    ],
  },
  {
    name: 'weight',
    title: t('Вес', 'Weight'),
    row: t('одно взвешивание', 'one weigh-in'),
    dataset: 'weight',
    fields: [
      f('date', t('Дата', 'Date'), t('Отделена от отметки времени, чтобы таблица соединялась с остальными', 'Separated from the timestamp so the table joins the others')),
      f('logged_at', t('Отметка времени', 'Timestamp'), t('За день взвешиваний может быть несколько', 'There can be several weigh-ins a day')),
      f('weight_kg', t('Вес, кг', 'Weight, kg')),
    ],
  },
  {
    name: 'body_values',
    title: t('Замеры тела', 'Body measurements'),
    row: t('один замер', 'one measurement'),
    dataset: 'body-values',
    fields: [
      f('date', t('Дата', 'Date')),
      f('logged_at', t('Отметка времени', 'Timestamp')),
      f('type', t('Вид замера', 'Measurement kind'), same('body_fat, muscle_ratio, waist, hip, chest')),
      f('value', t('Значение', 'Value'), t('Доли — в процентах, обхваты — в сантиметрах', 'Fractions in per cent, circumferences in centimetres')),
    ],
  },
  {
    name: 'feelings',
    title: t('Самочувствие', 'Feelings'),
    row: t('день с заметкой или тегами', 'a day with a note or tags'),
    dataset: 'feelings',
    note: t('Пустые дни в таблицу не попадают.', 'Empty days do not make it into the table.'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('note', t('Заметка дня', 'Note of the day')),
      f('tags', t('Теги настроения', 'Mood tags'), t('Через `;`', 'Separated by `;`')),
    ],
  },
  {
    name: 'streak',
    title: t('Серия ведения дневника', 'Diary streak'),
    row: t('день из календаря серии', 'a day from the streak calendar'),
    dataset: 'streak',
    fields: [
      f('date', t('Дата', 'Date')),
      f('daytimes', t('Что записано', 'What was logged'), t('Приёмы пищи через `;`', 'Meals separated by `;`')),
      f('origin_of_recovery', t('Чем восстановлена', 'How it was restored'), t('Если день был закрыт заморозкой серии', 'If the day was covered by a streak freeze')),
    ],
  },
  {
    name: 'products',
    title: t('Карточки продуктов', 'Product cards'),
    row: t('один продукт', 'one product'),
    dataset: 'products',
    nutrients: 'all',
    note: t('Нутриенты здесь — **на одну базовую единицу**, не на 100 грамм. В `nutrition_log` умножение уже сделано.', 'Nutrients here are **per one base unit**, not per 100 grams. In `nutrition_log` the multiplication is already done.'),
    fields: [
      f('product_id', t('Идентификатор', 'Id'), t('Соединяется с `nutrition_log.source_id`', 'Joins `nutrition_log.source_id`')),
      f('name', t('Название', 'Name')),
      f('producer', t('Производитель', 'Producer')),
      f('category', t('Категория', 'Category')),
      f('base_unit', t('Базовая единица', 'Base unit'), t('g или ml', 'g or ml')),
      f('is_verified', t('Проверен YAZIO', 'Verified by YAZIO')),
      f('is_private', t('Свой продукт', 'Own product'), t('Заведён пользователем, виден только ему', 'Created by the user and visible only to them')),
      f('is_deleted', t('Удалён из базы', 'Deleted from the database')),
      f('has_ean', t('Есть штрихкод', 'Has a barcode')),
      f('eans', t('Штрихкоды', 'Barcodes'), t('Через `;`', 'Separated by `;`')),
      f('language', t('Язык карточки', 'Card language')),
      f('countries', t('Страны', 'Countries'), t('Через `;`', 'Separated by `;`')),
      f('updated_at', t('Когда карточка правилась', 'When the card was edited'), t('Если продукт правили после записи в дневник, суммы дня могут разойтись с итогами YAZIO', 'If the product was edited after the diary entry, the day totals may disagree with YAZIO')),
    ],
  },
  {
    name: 'product_servings',
    title: t('Порции продуктов', 'Product servings'),
    row: t('продукт × вариант порции', 'product × serving variant'),
    dataset: 'products',
    fields: [
      f('product_id', t('Продукт', 'Product')),
      f('serving', t('Порция', 'Serving'), same('slice, piece, tablespoon…')),
      f('amount', t('Сколько единиц', 'How many units'), t('Один ломтик = 30 г', 'One slice = 30 g')),
    ],
  },
  {
    name: 'recipes',
    title: t('Рецепты', 'Recipes'),
    row: t('один рецепт', 'one recipe'),
    dataset: 'recipes',
    nutrients: 'all',
    note: t('Нутриенты — **на одну порцию**, не на весь рецепт.', 'Nutrients are **per portion**, not for the whole recipe.'),
    fields: [
      f('recipe_id', t('Идентификатор', 'Id'), t('Соединяется с `nutrition_log.source_id`', 'Joins `nutrition_log.source_id`')),
      f('name', t('Название', 'Name')),
      f('locale', t('Язык', 'Language')),
      f('portion_count', t('Порций в рецепте', 'Portions per recipe')),
      f('is_yazio_recipe', t('Рецепт YAZIO', 'YAZIO recipe')),
      f('is_pro_recipe', t('Из платной подписки', 'From the paid subscription')),
      f('is_user_recipe', t('Свой рецепт', 'Own recipe'), t('Найден по пользовательскому пути, а не в общей базе', 'Found on the user path, not in the shared database')),
      f('ingredient_count', t('Ингредиентов', 'Ingredients count')),
    ],
  },
  {
    name: 'recipe_ingredients',
    title: t('Ингредиенты', 'Ingredients'),
    row: t('рецепт × ингредиент', 'recipe × ingredient'),
    dataset: 'recipes',
    fields: [
      f('recipe_id', t('Рецепт', 'Recipe')),
      f('position', t('Порядковый номер', 'Position')),
      f('product_id', t('Продукт', 'Product'), t('Если ингредиент — карточка из базы', 'If the ingredient is a card from the database')),
      f('name / producer', t('Название и производитель', 'Name and producer')),
      f('amount', t('Количество', 'Amount')),
      f('base_unit', t('Единица', 'Unit')),
      f('serving / serving_quantity', t('Порция и сколько их', 'Serving and how many')),
      f('note', t('Примечание', 'Remark')),
    ],
  },
  {
    name: 'recipe_instructions',
    title: t('Шаги приготовления', 'Cooking steps'),
    row: t('рецепт × шаг', 'recipe × step'),
    dataset: 'recipes',
    fields: [
      f('recipe_id', t('Рецепт', 'Recipe')),
      f('step', t('Номер шага', 'Step number')),
      f('text', t('Текст шага', 'Step text')),
    ],
  },
  {
    name: 'profile',
    title: t('Профиль', 'Profile'),
    row: t('аккаунт, одна строка', 'the account, one row'),
    dataset: 'account',
    note: t('При обезличивании поля, опознающие человека, пустеют: uuid, почта, имя, дата рождения, город. Рост, пол, цель и единицы остаются — без них анализ бессмыслен.', 'When redacted, the fields that identify a person go empty: uuid, e-mail, name, date of birth, city. Height, sex, goal and units stay — without them the analysis is pointless.'),
    fields: [
      f('uuid / email', t('Идентификаторы аккаунта', 'Account ids')),
      f('first_name / last_name', t('Имя', 'Name')),
      f('sex', t('Пол', 'Sex')),
      f('date_of_birth', t('Дата рождения', 'Date of birth')),
      f('body_height_cm', t('Рост, см', 'Height, cm')),
      f('start_weight_kg', t('Вес на старте, кг', 'Starting weight, kg')),
      f('weight_change_per_week_kg', t('Заданный темп, кг/нед', 'Chosen rate, kg/week'), t('Отрицательный — снижение', 'Negative means losing')),
      f('goal', t('Цель', 'Goal'), same('lose, maintain, gain')),
      f('pal', t('Коэффициент активности', 'Activity factor'), t('Physical Activity Level, множитель к основному обмену', 'Physical Activity Level, a multiplier on the basal metabolism')),
      f('city / country', t('Город и страна', 'City and country')),
      f('language / locale', t('Язык интерфейса', 'Interface language')),
      f('timezone_offset', t('Смещение зоны, мин', 'Timezone offset, min')),
      f('unit_mass / unit_energy / unit_length / unit_serving / unit_glucose', t('Единицы в приложении', 'Units in the app'), t('На выгрузку не влияют: энергия всегда в ккал, масса в граммах', 'They do not affect the export: energy is always in kcal, mass in grams')),
      f('diet_name', t('Раскладка БЖУ', 'Macro split')),
      f('diet_carb_percentage / diet_fat_percentage / diet_protein_percentage', t('Доли макросов, %', 'Macro shares, %')),
      f('is_premium / premium_type', t('Подписка', 'Subscription')),
      f('login_type', t('Способ входа', 'Sign-in method'), t('email_password или вход через Apple/Google', 'email_password or sign-in through Apple/Google')),
      f('email_confirmation_status', t('Подтверждение почты', 'E-mail confirmation')),
      f('newsletter_opt_in', t('Согласие на рассылку', 'Newsletter consent')),
      f('registration_date', t('Дата регистрации', 'Registration date'), t('С неё начинается история аккаунта', 'The account history starts there')),
      f('last_active_date', t('Последняя активность', 'Last activity')),
      f('reset_date', t('Дата сброса данных', 'Data reset date')),
      f('tags', t('Метки аккаунта', 'Account labels')),
    ],
  },
  {
    name: 'settings',
    title: t('Настройки приложения', 'App settings'),
    row: t('одна настройка', 'one setting'),
    dataset: 'account',
    note: t('Таблица длинная, а не широкая: новый тумблер YAZIO попадает в выгрузку без правки кода.', 'The table is long, not wide: a new YAZIO toggle reaches the export without a code change.'),
    fields: [
      f('setting', t('Имя настройки', 'Setting name'), t('Точки в имени заменены подчёркиваниями', 'Dots in the name are replaced by underscores')),
      f('value', t('Значение', 'Value')),
    ],
  },
  {
    name: 'subscriptions',
    title: t('Подписки', 'Subscriptions'),
    row: t('одна подписка', 'one subscription'),
    dataset: 'account',
    fields: [
      f('start / end', t('Период действия', 'Validity period')),
      f('type', t('Тип подписки', 'Subscription type')),
      f('status', t('Состояние', 'State')),
      f('gateway', t('Через что оплачено', 'What it was paid through')),
      f('base_plan_id', t('Тариф', 'Plan')),
      f('last_status_change_at', t('Когда состояние менялось', 'When the state changed')),
    ],
  },
  {
    name: 'fasting_history',
    title: t('Голодания', 'Fasting'),
    row: t('один сеанс', 'one session'),
    dataset: 'fasting',
    note: t('Своего идентификатора у сеансов в API нет, поэтому три таблицы соединяются по сквозному номеру `session`.', 'Sessions have no id of their own in the API, so the three tables join on the running number `session`.'),
    fields: [
      f('session', t('Номер сеанса', 'Session number')),
      f('key', t('Схема', 'Scheme'), t('Например 16:8', 'For example 16:8')),
      f('start / end', t('Начало и конец', 'Start and end')),
    ],
  },
  {
    name: 'fasting_periods',
    title: t('Окна голодания', 'Fasting windows'),
    row: t('сеанс × окно', 'session × window'),
    dataset: 'fasting',
    fields: [
      f('session', t('Сеанс', 'Session')),
      f('period', t('Номер окна', 'Window number')),
      f('start_day / end_day', t('Смещение в днях', 'Day offset'), t('Ноль — тот же день, единица — следующий', 'Zero — the same day, one — the next')),
      f('start_time / end_time', t('Время начала и конца', 'Start and end time')),
    ],
  },
  {
    name: 'fasting_patches',
    title: t('Правки голоданий', 'Fasting edits'),
    row: t('сеанс × правка', 'session × edit'),
    dataset: 'fasting',
    fields: [
      f('session', t('Сеанс', 'Session')),
      f('period', t('Какое окно поправлено', 'Which window was edited')),
      f('start / end', t('Новые границы', 'New boundaries')),
    ],
  },
  {
    name: 'health_daily',
    title: t('Apple Health по дням', 'Apple Health by day'),
    row: t('один день', 'one day'),
    note: t('Появляется, только если выгрузка Apple Health загружена. На каждый день и показатель взят **один источник** — часы и телефон считают шаги независимо.', 'Appears only if an Apple Health export has been loaded. For each day and metric a **single source** is used — the watch and the phone count steps independently.'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('steps', t('Шаги', 'Steps')),
      f('active_energy_kcal', t('Активные ккал', 'Active kcal')),
      f('basal_energy_kcal', t('Базальные ккал', 'Basal kcal'), t('Основной обмен', 'Basal metabolism')),
      f('exercise_min', t('Минуты упражнений', 'Exercise minutes')),
      f('stand_hours', t('Часов стоя', 'Stand hours')),
      f('distance_km', t('Дистанция, км', 'Distance, km')),
      f('flights_climbed', t('Этажей', 'Flights')),
      f('resting_heart_rate', t('Пульс покоя', 'Resting heart rate')),
      f('heart_rate_avg', t('Средний пульс', 'Average heart rate')),
      f('hrv_ms', t('Вариабельность пульса, мс', 'Heart rate variability, ms')),
      f('respiratory_rate', t('Частота дыхания', 'Respiratory rate')),
      f('oxygen_saturation', t('Кислород в крови', 'Blood oxygen'), t('Доля от единицы', 'A fraction of one')),
      f('weight_kg', t('Вес по данным Health, кг', 'Weight from Health, kg')),
    ],
  },
  {
    name: 'health_workouts',
    title: t('Тренировки', 'Workouts'),
    row: t('одна тренировка', 'one workout'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('started_at', t('Начало', 'Start')),
      f('type', t('Вид тренировки', 'Workout kind')),
      f('duration_min', t('Длительность, мин', 'Duration, min')),
      f('energy_kcal', t('Сожжено, ккал', 'Burned, kcal')),
      f('distance_km', t('Дистанция, км', 'Distance, km')),
      f('source', t('Источник', 'Source')),
    ],
  },
  {
    name: 'health_sleep',
    title: t('Сон', 'Sleep'),
    row: t('одна ночь по одному источнику', 'one night from one source'),
    note: t('Ночь помечена датой пробуждения. За одну ночь строк может быть несколько — по числу источников.', 'A night is labelled with the wake-up date. One night can have several rows — one per source.'),
    fields: [
      f('night', t('Ночь', 'Night')),
      f('source', t('Источник', 'Source')),
      f('in_bed_min', t('В постели, мин', 'In bed, min')),
      f('asleep_min', t('Всего сна, мин', 'Total sleep, min')),
      f('deep_min', t('Глубокий, мин', 'Deep, min')),
      f('rem_min', t('REM, мин', 'REM, min')),
      f('core_min', t('Основной, мин', 'Core, min')),
      f('awake_min', t('Бодрствование, мин', 'Awake, min')),
      f('fell_asleep_at', t('Уснули', 'Fell asleep')),
      f('woke_at', t('Проснулись', 'Woke up')),
    ],
  },
  {
    name: 'daily_combined',
    title: t('День из обоих источников', 'Day from both sources'),
    row: t('один день, где есть хоть что-то', 'one day with anything at all'),
    note: t('Ради этой таблицы всё и делалось: YAZIO знает приход энергии, Apple Health — расход, и ни одно из приложений по отдельности баланса не показывает.', 'This table is what the whole thing was built for: YAZIO knows the energy coming in, Apple Health knows what goes out, and neither app on its own shows the balance.'),
    fields: [
      f('date', t('Дата', 'Date')),
      f('energy_in_kcal', t('Съедено, ккал', 'Eaten, kcal'), t('Итог YAZIO', 'YAZIO total')),
      f('energy_goal_kcal', t('Цель, ккал', 'Goal, kcal')),
      f('carbs_g / protein_g / fat_g', t('БЖУ, г', 'Macros, g'), t('Итоги YAZIO', 'YAZIO totals')),
      f('fiber_g', t('Клетчатка, г', 'Fibre, g'), t('Досчитана по карточкам продуктов', 'Computed from the product cards')),
      f('water_ml', t('Вода, мл', 'Water, ml')),
      f('active_energy_kcal', t('Активные ккал', 'Active kcal'), same('Apple Health')),
      f('basal_energy_kcal', t('Базальные ккал', 'Basal kcal'), same('Apple Health')),
      f('energy_out_kcal', t('Потрачено всего, ккал', 'Total spent, kcal'), t('Активные плюс базальные', 'Active plus basal')),
      f('balance_kcal', t('Баланс, ккал', 'Balance, kcal'), t('Съедено минус потрачено; пусто, если известна лишь одна половина. Отрицательный — дефицит', 'Eaten minus spent; empty if only one half is known. Negative means a deficit')),
      f('steps', t('Шаги', 'Steps')),
      f('exercise_min', t('Минуты упражнений', 'Exercise minutes')),
      f('asleep_min', t('Сон, мин', 'Sleep, min'), t('Ночь, помеченная этой датой', 'The night labelled with this date')),
      f('deep_min', t('Глубокий сон, мин', 'Deep sleep, min')),
      f('resting_heart_rate', t('Пульс покоя', 'Resting heart rate')),
      f('weight_yazio_kg', t('Вес по YAZIO, кг', 'Weight from YAZIO, kg'), t('Два измерения намеренно не сведены в одно: расхождение само по себе информативно', 'The two measurements are deliberately kept apart: the discrepancy is informative in itself')),
      f('weight_health_kg', t('Вес по Apple Health, кг', 'Weight from Apple Health, kg')),
    ],
  },
  {
    name: 'warnings',
    title: t('Замечания', 'Warnings'),
    row: t('одна замеченная проблема', 'one noticed problem'),
    note: t('Пусто на чистой выгрузке. Сюда попадают расхождения сверки с итогами YAZIO, пропуски дней и нутриенты, которых нет в реестре.', 'Empty on a clean export. Here land the mismatches against YAZIO totals, missing days and nutrients absent from the registry.'),
    fields: [
      f('phase', t('Этап', 'Stage'), t('Сверка, Полнота, Нутриенты', 'Reconciliation, Completeness, Nutrients')),
      f('key', t('К чему относится', 'What it refers to'), t('Обычно дата', 'Usually a date')),
      f('message', t('Что именно замечено', 'What exactly was noticed')),
    ],
  },
];
