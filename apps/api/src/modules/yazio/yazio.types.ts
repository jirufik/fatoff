/**
 * Формы ответов API YAZIO (v9).
 *
 * Типы намеренно снисходительны: почти всё необязательно, а карты нутриентов
 * и настроек оставлены открытыми. API недокументировано, и падать на новом
 * ключе — худшее, что может сделать выгрузка. Сырьё всё равно сохраняется
 * целиком (D-003), поэтому неучтённое поле не теряется, а просто не попадает
 * в таблицы до тех пор, пока о нём не узнают.
 */

export interface YazioToken {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number;
  token_type?: string;
}

/** Ключи вида `energy.energy`, `nutrient.carb`, `vitamin.b12`. */
export type NutrientMap = Record<string, number>;

export interface YazioUser {
  registration_date: string;
  uuid?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  sex?: string | null;
  date_of_birth?: string | null;
  body_height?: number | null;
  start_weight?: number | null;
  weight_change_per_week?: number | null;
  goal?: string | null;
  pal?: number | null;
  city?: string | null;
  country?: string | null;
  language?: string | null;
  locale?: string | null;
  timezone_offset?: number | null;
  unit_mass?: string | null;
  unit_energy?: string | null;
  unit_length?: string | null;
  unit_serving?: string | null;
  unit_glucose?: string | null;
  is_premium?: boolean | null;
  premium_type?: string | null;
  login_type?: string | null;
  email_confirmation_status?: string | null;
  newsletter_opt_in?: boolean | null;
  last_active_date?: string | null;
  reset_date?: string | null;
  profile_image?: string | null;
  user_token?: string | null;
  diet?: {
    name?: string | null;
    carb_percentage?: number | null;
    fat_percentage?: number | null;
    protein_percentage?: number | null;
  } | null;
  tags?: string[];
}

export type YazioSettings = Record<string, unknown>;

export interface YazioDietaryPreferences {
  restriction?: string | null;
}

export interface YazioSubscription {
  start?: string | null;
  end?: string | null;
  gateway?: string | null;
  type?: string | null;
  status?: string | null;
  last_status_change_at?: string | null;
  base_plan_id?: string | null;
}

export interface YazioStreakDay {
  daytimes?: string[];
  origin_of_recovery?: string | null;
}

/** Ключ — дата `YYYY-MM-DD`. */
export type YazioStreak = Record<string, YazioStreakDay>;

export interface YazioFastingBoundary {
  day?: number;
  time?: string | null;
}

export interface YazioFastingSession {
  key?: string | null;
  start?: string | null;
  end?: string | null;
  fasting_periods?: Array<{ start: YazioFastingBoundary; end: YazioFastingBoundary }>;
  patches?: Array<{ period_index?: number; start?: string | null; end?: string | null }>;
}

export interface YazioDailyNutrients {
  date: string;
  energy?: number;
  carb?: number;
  protein?: number;
  fat?: number;
  energy_goal?: number;
}

export interface YazioExerciseSummary {
  date: string;
  duration?: number;
  steps?: number;
  energy?: number;
}

/** Ответ диапазонной формы `/user/bodyvalues/{kind}` — только дата и значение. */
export interface YazioBodyValue {
  date: string;
  value?: number;
}

export interface YazioFeeling {
  note?: string | null;
  tags?: string[];
}

export interface YazioWater {
  water_intake?: number;
  gateway?: string | null;
  source?: string | null;
}

/** Ключи целей идут через точку: `energy.energy`, `activity.step`, `water`. */
export type YazioGoals = Record<string, number>;

export interface YazioConsumedProduct {
  id?: string | null;
  product_id: string;
  /** Полная отметка времени записи, не дата дня. */
  date: string;
  daytime: string;
  amount: number;
  serving?: string | null;
  serving_quantity?: number | null;
  type?: string | null;
}

export interface YazioRecipePortion {
  id?: string | null;
  recipe_id: string;
  date: string;
  daytime: string;
  portion_count?: number;
}

/** Быстрая запись: нутриенты уже итоговые, базовой единицы нет. */
export interface YazioSimpleProduct extends Record<string, unknown> {
  id?: string | null;
  date: string;
  daytime: string;
  name?: string | null;
  is_ai_generated?: boolean | null;
  nutrients?: NutrientMap;
}

export interface YazioConsumedItems {
  products?: YazioConsumedProduct[];
  recipe_portions?: YazioRecipePortion[];
  simple_products?: YazioSimpleProduct[];
}

export interface YazioProductServing {
  serving?: string | null;
  amount?: number;
}

export interface YazioProduct {
  name?: string | null;
  producer?: string | null;
  category?: string | null;
  base_unit?: string | null;
  is_verified?: boolean;
  is_private?: boolean;
  is_deleted?: boolean;
  has_ean?: boolean;
  eans?: string[] | null;
  countries?: string[] | null;
  language?: string | null;
  updated_at?: string | null;
  servings?: YazioProductServing[];
  /** На одну базовую единицу — грамм или миллилитр, не на 100. */
  nutrients?: NutrientMap;
}

export interface YazioRecipeServing {
  product_id?: string | null;
  name?: string | null;
  producer?: string | null;
  amount?: number;
  base_unit?: string | null;
  serving?: string | null;
  serving_quantity?: number | null;
  note?: string | null;
}

export interface YazioRecipe {
  name?: string | null;
  locale?: string | null;
  portion_count?: number;
  is_yazio_recipe?: boolean;
  is_pro_recipe?: boolean;
  /** На одну порцию, а не на весь рецепт. */
  nutrients?: NutrientMap;
  servings?: YazioRecipeServing[];
  instructions?: unknown[];
}

export interface YazioTraining {
  id?: string | null;
  name?: string | null;
  note?: string | null;
  energy?: number;
  duration?: number;
  distance?: number;
  steps?: number;
  gateway?: string | null;
  source?: string | null;
}

export interface YazioActivity {
  energy?: number;
  steps?: number;
  distance?: number;
  duration?: number;
  source?: string | null;
  gateway?: string | null;
}

export interface YazioExercises {
  activity?: YazioActivity | null;
  training?: YazioTraining[];
  custom_training?: YazioTraining[];
}
