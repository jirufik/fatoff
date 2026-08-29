import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { addDays, today as todayOf } from '../../common/date.util';
import { Account } from '../../database/entities';
import { HEALTH_DAILY_CTE } from '../apple-health/health.sql';

import type { TargetsInput } from './targets';

/** За сколько дней берутся медианы расхода и потребления. */
const WINDOW_DAYS = 365;

/**
 * Факты об аккаунте, на которых считаются нормы.
 *
 * Отдельный провайдер, потому что этими же числами пользуются и журнал дня (для
 * оценки), и генератор (для целей). Медианы, а не средние: один день с
 * забытыми на руке часами или ужин в гостях не должны двигать норму.
 */
@Injectable()
export class AccountFactsService {
  constructor(private readonly em: EntityManager) {}

  async collect(accountId: string, on?: string): Promise<TargetsInput> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const today = on ?? todayOf();
    const from = addDays(today, -WINDOW_DAYS);
    const profile = (account.profile ?? {}) as Record<string, unknown>;

    const [weight, bodyFat, expenditure, intake, goals] = await Promise.all([
      this.lastBodyValue(accountId, 'weight'),
      this.bodyFat(accountId),
      this.expenditure(accountId, from, today),
      this.intake(accountId, from, today),
      this.goals(accountId),
    ]);

    return {
      sex: profile.sex === 'male' ? 'male' : profile.sex === 'female' ? 'female' : null,
      birthDate: typeof profile.date_of_birth === 'string' ? profile.date_of_birth : null,
      heightCm: numberOf(profile.body_height),
      weightKg: weight,
      bodyFatPct: bodyFat.value,
      bodyFatSource: bodyFat.source,
      expenditure,
      intakeKcal: intake,
      yazio: goals,
      today,
    };
  }

  /** Последнее взвешивание или замер: состав тела берётся по последнему известному. */
  private async lastBodyValue(accountId: string, kind: string): Promise<number | null> {
    const [row] = await this.em.getConnection().execute<Array<{ value: string }>>(
      `select value from body_value
        where account_id = ? and kind = ?
        order by logged_at desc limit 1`,
      [accountId, kind],
    );
    return row ? Number(row.value) : null;
  }

  /**
   * Доля жира: сначала YAZIO, потом Apple Health.
   *
   * В YAZIO она есть не всегда — эти замеры делает не приложение, а весы; в
   * Health они приходят от них же, но долей, а не процентом. Без доли жира не
   * посчитать безжировую массу, а без неё — энергодоступность, то есть главную
   * проверку всего расчёта. Если нет нигде, оценка считается по индексу массы
   * тела в `computeTargets` и честно помечается оценкой.
   */
  private async bodyFat(
    accountId: string,
  ): Promise<{ value: number | null; source: 'yazio' | 'health' | null }> {
    const yazio = await this.lastBodyValue(accountId, 'body_fat');
    if (yazio !== null) return { value: yazio, source: 'yazio' };

    const [row] = await this.em.getConnection().execute<Array<{ value: string }>>(
      `select value from health_point
        where account_id = ? and type = 'BodyFatPercentage'
        order by measured_at desc limit 1`,
      [accountId],
    );
    if (!row) return { value: null, source: null };

    // Health хранит долей: 0.2987 — это 29.87 %
    const value = Number(row.value);
    return {
      value: Number.isFinite(value) ? Math.round((value <= 1 ? value * 100 : value) * 10) / 10 : null,
      source: 'health',
    };
  }

  /**
   * Расход: медианы активной и базальной энергии плюс средняя энергия тренировок
   * по всем дням периода — не только тренировочным. Для энергодоступности важно
   * именно среднее по дням: она считается на день, а не на тренировку.
   */
  private async expenditure(
    accountId: string,
    from: string,
    to: string,
  ): Promise<TargetsInput['expenditure']> {
    const [row] = await this.em.getConnection().execute<
      Array<{
        basal: string | null;
        active: string | null;
        days: string;
        workout: string | null;
      }>
    >(
      `with ${HEALTH_DAILY_CTE},
       counted as (
         select count(*)::int as days,
                percentile_cont(0.5) within group (order by basal_kcal) as basal,
                percentile_cont(0.5) within group (order by active_kcal) as active
           from health where active_kcal is not null or basal_kcal is not null
       ),
       workout as (
         select sum(energy_kcal) as total
           from health_workout where account_id = ? and date between ? and ?
       )
       select c.basal, c.active, c.days,
              case when c.days > 0 then w.total / c.days end as workout
         from counted c cross join workout w`,
      [accountId, from, to, accountId, from, to],
    );

    return {
      basalKcal: rounded(row?.basal),
      activeKcal: rounded(row?.active),
      workoutKcalPerDay: rounded(row?.workout),
      daysCovered: Number(row?.days ?? 0),
    };
  }

  /** Сколько она ест сейчас — медиана по дням, где еда вообще записана. */
  private async intake(accountId: string, from: string, to: string): Promise<number | null> {
    const [row] = await this.em.getConnection().execute<Array<{ median: string | null }>>(
      `select percentile_cont(0.5) within group (order by energy) as median
         from daily_nutrients
        where account_id = ? and date between ? and ? and energy > 0`,
      [accountId, from, to],
    );
    return rounded(row?.median);
  }

  /** Цели, стоящие в самом YAZIO: берутся из последнего дня, где они заданы. */
  private async goals(accountId: string): Promise<TargetsInput['yazio']> {
    const [row] = await this.em.getConnection().execute<
      Array<{ goals: Record<string, unknown> | null }>
    >(
      // не «goals is not null»: пустой объект тоже не null, а целей в нём нет —
      // сверяемся по самому ключу калорийности
      `select goals from day_snapshot
        where account_id = ? and goals->>'energy.energy' is not null
        order by date desc limit 1`,
      [accountId],
    );

    const goals = row?.goals ?? {};
    return {
      energyKcal: numberOf(goals['energy.energy']),
      proteinG: numberOf(goals['nutrient.protein']),
      carbsG: numberOf(goals['nutrient.carb']),
      fatG: numberOf(goals['nutrient.fat']),
      fiberG: numberOf(goals['nutrient.dietaryfiber']),
    };
  }
}

function numberOf(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? Math.round(num * 10) / 10 : null;
}

function rounded(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : null;
}
