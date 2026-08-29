/** Срезы аккаунта, которые можно выгружать и экспортировать по отдельности. */
export const DATASETS = [
  'diary',
  'products',
  'recipes',
  'activity',
  'water',
  'goals',
  'weight',
  'body-values',
  'feelings',
  'streak',
  'account',
  'fasting',
] as const;

export type Dataset = (typeof DATASETS)[number];

/** Датасеты, без которых этот бессмысленен. */
export const DATASET_REQUIRES: Partial<Record<Dataset, Dataset[]>> = {
  products: ['diary'],
  recipes: ['diary'],
};

export const EXPORT_FORMATS = ['markdown', 'json', 'toon', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Дата в виде `YYYY-MM-DD`. Хранится и передаётся строкой — см. D-006. */
export type IsoDate = string;

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/**
 * Сообщение для человека: код и подстановки, а не готовая фраза.
 *
 * Сервер не сочиняет текст — он сообщает, что произошло и с какими числами, а
 * предложение собирает интерфейс на выбранном языке. Так обе версии текста
 * лежат в одном месте и не могут разъехаться, а тесты проверяют коды, а не
 * формулировки, и не падают от правки запятой.
 */
export interface Message {
  code: string;
  params?: Record<string, string | number>;
}

export const message = (code: string, params?: Record<string, string | number>): Message =>
  params ? { code, params } : { code };

/**
 * Двуязычная строка из справочника.
 *
 * Для описаний настроек, названий полей и прочего, что живёт в коде как данные,
 * это проще кодов: обе версии стоят рядом, и добавить настройку — по-прежнему
 * одна запись, а не запись плюс две правки словарей.
 */
export interface Text {
  ru: string;
  en: string;
}

export type Locale = keyof Text;
