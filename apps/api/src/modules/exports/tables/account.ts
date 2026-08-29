import type { ExportSource } from '../source';
import { TableBuilder, join, num, scalar, str, type Cell, type Table } from '../table';

/**
 * Профиль — одна строка.
 *
 * `redact` гасит поля, которые опознают человека, но не описывают его тело и
 * привычки. Стоит включать перед тем, как отдать файл куда-то ещё: рост, пол и
 * цель для анализа нужны, а почта и город — нет.
 */
export function profileTable(source: ExportSource): Table {
  const builder = new TableBuilder('profile', [
    'uuid',
    'email',
    'first_name',
    'last_name',
    'sex',
    'date_of_birth',
    'body_height_cm',
    'start_weight_kg',
    'weight_change_per_week_kg',
    'goal',
    'pal',
    'city',
    'country',
    'language',
    'locale',
    'timezone_offset',
    'unit_mass',
    'unit_energy',
    'unit_length',
    'unit_serving',
    'unit_glucose',
    'diet_name',
    'diet_carb_percentage',
    'diet_fat_percentage',
    'diet_protein_percentage',
    'is_premium',
    'premium_type',
    'login_type',
    'email_confirmation_status',
    'newsletter_opt_in',
    'registration_date',
    'last_active_date',
    'reset_date',
    'tags',
  ]);

  const user = source.user;
  if (!user) return builder.finish();

  const personal = (value: string | null | undefined): Cell => (source.redact ? null : str(value));
  const diet = user.diet ?? null;

  builder.push([
    personal(user.uuid),
    personal(user.email),
    personal(user.first_name),
    personal(user.last_name),
    str(user.sex),
    personal(user.date_of_birth),
    num(user.body_height),
    num(user.start_weight),
    num(user.weight_change_per_week),
    str(user.goal),
    num(user.pal),
    personal(user.city),
    str(user.country),
    str(user.language),
    str(user.locale),
    num(user.timezone_offset),
    str(user.unit_mass),
    str(user.unit_energy),
    str(user.unit_length),
    str(user.unit_serving),
    str(user.unit_glucose),
    str(diet?.name),
    num(diet?.carb_percentage),
    num(diet?.fat_percentage),
    num(diet?.protein_percentage),
    user.is_premium ?? false,
    str(user.premium_type),
    str(user.login_type),
    str(user.email_confirmation_status),
    user.newsletter_opt_in ?? false,
    str(user.registration_date),
    str(user.last_active_date),
    str(user.reset_date),
    join(user.tags),
  ]);

  return builder.finish();
}

/**
 * Настройки — таблица длинная, а не широкая: строка на тумблер. Так новый
 * тумблер YAZIO попадает в выгрузку без правки кода.
 */
export function settingsTable(source: ExportSource): Table {
  const builder = new TableBuilder('settings', ['setting', 'value']);

  for (const [key, value] of Object.entries(source.settings ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    builder.push([key.replaceAll('.', '_'), scalar(value)]);
  }

  builder.push(['dietary_restriction', str(source.dietaryPreferences?.restriction)]);
  return builder.finish();
}

export function subscriptionsTable(source: ExportSource): Table {
  const builder = new TableBuilder('subscriptions', [
    'start',
    'end',
    'type',
    'status',
    'gateway',
    'base_plan_id',
    'last_status_change_at',
  ]);

  for (const record of source.subscriptions) {
    builder.push([
      str(record.start),
      str(record.end),
      str(record.type),
      str(record.status),
      str(record.gateway),
      str(record.base_plan_id),
      str(record.last_status_change_at),
    ]);
  }

  return builder.finish();
}

/**
 * История голоданий вложена двумя массивами на сеанс, поэтому разворачивается в
 * три таблицы, соединённые по номеру сеанса: своего идентификатора API им не даёт.
 */
export function fastingTables(source: ExportSource): {
  history: Table;
  periods: Table;
  patches: Table;
} {
  const history = new TableBuilder('fasting_history', ['session', 'key', 'start', 'end']);
  const periods = new TableBuilder('fasting_periods', [
    'session',
    'period',
    'start_day',
    'start_time',
    'end_day',
    'end_time',
  ]);
  const patches = new TableBuilder('fasting_patches', ['session', 'period', 'start', 'end']);

  source.fasting.forEach((session, index) => {
    const id = index + 1;
    history.push([id, str(session.key), str(session.start), str(session.end)]);

    (session.fasting_periods ?? []).forEach((period, position) => {
      periods.push([
        id,
        position,
        num(period.start?.day ?? 0),
        str(period.start?.time),
        num(period.end?.day ?? 0),
        str(period.end?.time),
      ]);
    });

    for (const patch of session.patches ?? []) {
      patches.push([id, num(patch.period_index ?? 0), str(patch.start), str(patch.end)]);
    }
  });

  return { history: history.finish(), periods: periods.finish(), patches: patches.finish() };
}
