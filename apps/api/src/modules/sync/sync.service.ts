import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  Dataset,
  StartSyncRequest,
  SyncRunDetailDto,
  SyncRunDto,
  SyncWarningDto,
} from '@fatoff/contracts';

import { dayOf, today as todayOf } from '../../common/date.util';
import { mapLimit } from '../../common/limit.util';
import { AppConfigService } from '../../config/app-config.service';
import {
  Account,
  AccountSnapshot,
  BodyValue,
  DailyExercise,
  DailyNutrients,
  DaySnapshot,
  ProductCache,
  RecipeCache,
  SyncRun,
  SyncWarning,
} from '../../database/entities';
import type { AccountSnapshotKind } from '../../database/entities/account-snapshot.entity';
import { BODY_VALUE_KINDS, YazioAuthError, type YazioClient } from '../yazio/yazio-client';
import { YazioService } from '../yazio/yazio.service';
import { planDays, resolveDatasets, type StoredDay } from './sync-plan';
import { WarningCollector } from './warnings';

/** Как часто прогресс уезжает в базу. Чаще незачем: фронт опрашивает раз в секунду. */
const PROGRESS_INTERVAL_MS = 500;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly cfg: AppConfigService,
    private readonly yazio: YazioService,
  ) {}

  // ── управление запусками ───────────────────────────────────────────────────

  /**
   * Ставит синхронизацию и сразу отвечает. Работа идёт в фоне, а её ход виден
   * через `sync_run`: держать HTTP-соединение открытым часами нельзя.
   */
  async start(accountId: string, request: StartSyncRequest): Promise<SyncRunDto> {
    const run = await this.createRun(accountId, request);

    // намеренно без await: HTTP-ответ не ждёт выгрузки
    void this.execute(run.id).catch((error: unknown) => {
      this.logger.error(`Синхронизация ${run.id} упала: ${String(error)}`);
    });

    return this.toDto(run);
  }

  /** Как `start`, но дожидается конца — для расписания и тестов. */
  async runNow(accountId: string, request: StartSyncRequest): Promise<SyncRunDto> {
    const run = await this.createRun(accountId, request);
    await this.execute(run.id);
    return this.toDto(await this.em.fork().findOneOrFail(SyncRun, { id: run.id }));
  }

  private async createRun(accountId: string, request: StartSyncRequest): Promise<SyncRun> {
    const account = await this.em.findOne(Account, { id: accountId });
    if (!account) throw new Error(`Аккаунт ${accountId} не найден`);

    const active = await this.em.findOne(SyncRun, {
      account: accountId,
      status: { $in: ['queued', 'running'] },
    });
    if (active) throw new Error('Синхронизация этого аккаунта уже идёт');

    const to = request.to ?? todayOf();
    const from = request.from ?? account.registrationDate ?? to;
    if (from > to) throw new Error(`Начало периода ${from} позже конца ${to}`);

    const run = this.em.create(SyncRun, {
      account,
      mode: request.mode ?? (request.from || request.to ? 'range' : 'incremental'),
      status: 'queued',
      dateFrom: from,
      dateTo: to,
      datasets: resolveDatasets(request.datasets),
      allDays: request.allDays ?? false,
      force: request.force ?? false,
      daysTotal: 0,
      daysDone: 0,
      requests: 0,
      warningsCount: 0,
      cancelRequested: false,
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(run);
    return run;
  }

  async listRuns(accountId: string, limit = 20): Promise<SyncRunDto[]> {
    const runs = await this.em.find(
      SyncRun,
      { account: accountId },
      { orderBy: { createdAt: 'desc' }, limit },
    );
    return runs.map((run) => this.toDto(run));
  }

  async runDetail(runId: string): Promise<SyncRunDetailDto> {
    const run = await this.em.findOne(SyncRun, { id: runId });
    if (!run) throw new Error(`Запуск ${runId} не найден`);

    const warnings = await this.em.find(
      SyncWarning,
      { run: runId },
      { orderBy: { createdAt: 'asc' }, limit: 500 },
    );
    return {
      ...this.toDto(run),
      warnings: warnings.map((w) => ({
        phase: w.phase,
        endpoint: w.endpoint,
        key: w.key,
        kind: w.kind,
        status: w.status,
        message: w.message,
      })),
    };
  }

  /** Отмена мягкая: флаг проверяется между днями, запрос на полуслове не рвётся. */
  async cancel(runId: string): Promise<SyncRunDto> {
    const run = await this.em.findOne(SyncRun, { id: runId });
    if (!run) throw new Error(`Запуск ${runId} не найден`);
    if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') return this.toDto(run);

    run.cancelRequested = true;
    await this.em.flush();
    return this.toDto(run);
  }

  // ── движок ─────────────────────────────────────────────────────────────────

  /** Прогон целиком. Публичный, чтобы тесты и планировщик могли ждать окончания. */
  async execute(runId: string): Promise<void> {
    // своя единица работы: прогон живёт минутами и не должен делить её с HTTP-запросом
    const em = this.em.fork();
    const run = await em.findOne(SyncRun, { id: runId }, { populate: ['account'] });
    if (!run) throw new Error(`Запуск ${runId} не найден`);

    const account = run.account;
    const warnings = new WarningCollector();
    const client = this.yazio.clientFor(account);
    const datasets = new Set<Dataset>(run.datasets);

    run.status = 'running';
    run.startedAt = new Date();
    await em.flush();

    let cancelled = false;
    let lastProgressAt = 0;

    const progress = async (phase: string, daysDone?: number, force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;

      run.phase = phase;
      if (daysDone !== undefined) run.daysDone = daysDone;
      run.requests = client.requests;
      run.warningsCount = warnings.length;
      await em.flush();

      // флаг отмены ставится другим запросом, поэтому читается из базы, а не из памяти
      const [row] = await em.getConnection().execute<Array<{ cancel_requested: boolean }>>(
        'select cancel_requested from sync_run where id = ?',
        [runId],
      );
      cancelled = Boolean(row?.cancel_requested);
    };

    /** Запрос, чей провал становится предупреждением, а не концом выгрузки. */
    const attempt = async <T>(
      phase: string,
      endpoint: string,
      key: string | null,
      task: () => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      try {
        return await task();
      } catch (error) {
        // неверные учётные данные — не «пропустим этот день», а конец работы
        if (error instanceof YazioAuthError) throw error;
        warnings.record(phase, endpoint, key, error);
        return fallback;
      }
    };

    try {
      // ── профиль: он же говорит, с какой даты начинается история ────────────
      await progress('Профиль', 0, true);
      const user = await client.user();
      await this.saveAccountSnapshot(em, account, 'user', user as unknown as Record<string, unknown>);
      account.profile = user as unknown as Record<string, unknown>;
      if (user.registration_date) account.registrationDate = dayOf(user.registration_date);

      const to = run.dateTo;
      const from = run.mode === 'full' ? (account.registrationDate ?? run.dateFrom) : run.dateFrom;
      run.dateFrom = from;

      // ── дневные итоги: один запрос на период, он же детектор изменений ─────
      await progress('Итоги по дням', 0, true);
      const remote = (await client.dailyNutrients(from, to)).map((day) => ({
        date: dayOf(day.date),
        energy: day.energy ?? 0,
        carb: day.carb ?? 0,
        protein: day.protein ?? 0,
        fat: day.fat ?? 0,
        energyGoal: day.energy_goal ?? 0,
      }));

      // дневные эндпоинты спрашиваются только ради этих срезов; без них
      // проходить по дням незачем — всё остальное берётся диапазонными запросами
      const dayLevel: Dataset[] = ['diary', 'activity', 'water', 'goals', 'feelings'];
      const needsDays = dayLevel.some((dataset) => datasets.has(dataset));

      const stored = needsDays ? await this.storedDays(em, account.id, from, to) : [];
      const plan = !needsDays ? [] : planDays({
        from,
        to,
        remote,
        stored,
        today: todayOf(),
        resyncDays: this.cfg.get('YAZIO_RESYNC_DAYS'),
        allDays: run.allDays,
        force: run.force,
      });

      run.daysTotal = plan.length;
      await progress('Дневник', 0, true);

      if (remote.length > 0) {
        await em.upsertMany(
          DailyNutrients,
          remote.map((day) => ({ id: randomUUID(), account, ...day, fetchedAt: new Date() })),
          {
            onConflictFields: ['account', 'date'],
            onConflictMergeFields: ['energy', 'carb', 'protein', 'fat', 'energyGoal', 'fetchedAt'],
          },
        );
      }

      // ── дневник и всё, что запрашивается по одному дню ─────────────────────
      const concurrency = this.cfg.get('YAZIO_CONCURRENCY');
      await mapLimit(
        plan,
        concurrency,
        async ({ date }) => {
          if (cancelled) return;
          await this.fetchDay(em, client, account, date, datasets, attempt);
        },
        (done) => progress('Дневник', done),
      );
      await progress('Дневник', plan.length, true);

      if (!cancelled) {
        await this.fetchCatalogues(em, client, account, datasets, attempt, progress);
      }
      if (!cancelled) {
        await this.fetchAccountWide(em, client, account, from, to, datasets, attempt, progress);
      }

      run.status = cancelled ? 'cancelled' : 'done';
      run.phase = cancelled ? 'Отменено' : 'Готово';
      account.lastSyncStatus = cancelled ? 'failed' : 'ok';
      account.lastSyncAt = new Date();
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      account.lastSyncStatus = 'failed';
      account.lastSyncAt = new Date();
      this.logger.error(`Синхронизация ${runId}: ${run.error}`);
    } finally {
      run.requests = client.requests;
      run.warningsCount = warnings.length;
      run.finishedAt = new Date();
      await this.saveWarnings(em, run, warnings.all());
      await em.flush();
    }
  }

  // ── этапы ──────────────────────────────────────────────────────────────────

  /** Шесть дневных эндпоинтов; каждый падает по отдельности, день сохраняется всё равно. */
  private async fetchDay(
    em: EntityManager,
    client: YazioClient,
    account: Account,
    date: string,
    datasets: Set<Dataset>,
    attempt: <T>(phase: string, endpoint: string, key: string | null, task: () => Promise<T>, fallback: T) => Promise<T>,
  ): Promise<void> {
    const wants = (dataset: Dataset): boolean => datasets.has(dataset);

    const [consumed, exercises, water, goals, goalsUnmodified, feeling] = await Promise.all([
      wants('diary')
        ? attempt('Дневник', 'consumed-items', date, () => client.consumed(date), null)
        : null,
      wants('activity')
        ? attempt('Активность', 'exercises', date, () => client.exercises(date), null)
        : null,
      wants('water') ? attempt('Вода', 'water-intake', date, () => client.water(date), null) : null,
      wants('goals') ? attempt('Цели', 'goals', date, () => client.goals(date), null) : null,
      wants('goals')
        ? attempt('Цели', 'goals-unmodified', date, () => client.goalsUnmodified(date), null)
        : null,
      wants('feelings')
        ? attempt('Самочувствие', 'feeling', date, () => client.feeling(date), null)
        : null,
    ]);

    // записываются только выбранные срезы: иначе выгрузка одних целей стёрла бы
    // ранее выгруженный дневник, обнулив поле, которого в этот раз не спрашивали
    const patch: Record<string, unknown> = {};
    if (wants('diary')) patch.consumed = consumed;
    if (wants('activity')) patch.exercises = exercises;
    if (wants('water')) patch.water = water;
    if (wants('goals')) {
      patch.goals = goals;
      patch.goalsUnmodified = goalsUnmodified;
    }
    if (wants('feelings')) patch.feeling = feeling;
    if (Object.keys(patch).length === 0) return;

    await em.upsert(
      DaySnapshot,
      { id: randomUUID(), account, date, ...patch, fetchedAt: new Date() },
      {
        onConflictFields: ['account', 'date'],
        onConflictMergeFields: [...Object.keys(patch), 'fetchedAt'] as Array<keyof DaySnapshot>,
      },
    );
  }

  /** Карточки продуктов и рецептов, на которые ссылается дневник. */
  private async fetchCatalogues(
    em: EntityManager,
    client: YazioClient,
    account: Account,
    datasets: Set<Dataset>,
    attempt: <T>(phase: string, endpoint: string, key: string | null, task: () => Promise<T>, fallback: T) => Promise<T>,
    progress: (phase: string, daysDone?: number, force?: boolean) => Promise<void>,
  ): Promise<void> {
    const concurrency = this.cfg.get('YAZIO_CONCURRENCY');

    if (datasets.has('products')) {
      await progress('Продукты', undefined, true);
      const missing = await this.missingIds(em, account.id, 'product');
      await mapLimit(missing, concurrency, async (productId) => {
        const product = await attempt('Продукты', 'product', productId, () => client.product(productId), null);
        if (!product) return;
        await em.upsert(
          ProductCache,
          {
            id: randomUUID(),
            account,
            productId,
            payload: product as unknown as Record<string, unknown>,
            name: product.name ?? null,
            fetchedAt: new Date(),
          },
          {
            onConflictFields: ['account', 'productId'],
            onConflictMergeFields: ['payload', 'name', 'fetchedAt'],
          },
        );
      });
    }

    if (datasets.has('recipes')) {
      await progress('Рецепты', undefined, true);
      const missing = await this.missingIds(em, account.id, 'recipe');
      await mapLimit(missing, concurrency, async (recipeId) => {
        const result = await attempt('Рецепты', 'recipe', recipeId, () => client.recipe(recipeId), null);
        if (!result) return;
        await em.upsert(
          RecipeCache,
          {
            id: randomUUID(),
            account,
            recipeId,
            payload: result.recipe as unknown as Record<string, unknown>,
            isUserRecipe: result.isUserRecipe,
            fetchedAt: new Date(),
          },
          {
            onConflictFields: ['account', 'recipeId'],
            onConflictMergeFields: ['payload', 'isUserRecipe', 'fetchedAt'],
          },
        );
      });
    }

  }

  /** Всё, что стоит один запрос независимо от длины периода. */
  private async fetchAccountWide(
    em: EntityManager,
    client: YazioClient,
    account: Account,
    from: string,
    to: string,
    datasets: Set<Dataset>,
    attempt: <T>(phase: string, endpoint: string, key: string | null, task: () => Promise<T>, fallback: T) => Promise<T>,
    progress: (phase: string, daysDone?: number, force?: boolean) => Promise<void>,
  ): Promise<void> {
    await progress('Аккаунт', undefined, true);

    if (datasets.has('account')) {
      const settings = await attempt('Аккаунт', 'settings', null, () => client.settings(), null);
      if (settings) await this.saveAccountSnapshot(em, account, 'settings', settings);

      const preferences = await attempt('Аккаунт', 'dietary-preferences', null, () => client.dietaryPreferences(), null);
      if (preferences) await this.saveAccountSnapshot(em, account, 'dietary_preferences', preferences as Record<string, unknown>);

      const subscriptions = await attempt('Аккаунт', 'subscription', null, () => client.subscriptions(), null);
      if (subscriptions) await this.saveAccountSnapshot(em, account, 'subscription', { items: subscriptions });
    }

    if (datasets.has('streak')) {
      const streak = await attempt('Аккаунт', 'streak', null, () => client.streak(), null);
      if (streak) await this.saveAccountSnapshot(em, account, 'streak', streak as Record<string, unknown>);
    }

    if (datasets.has('fasting')) {
      const fasting = await attempt('Аккаунт', 'fasting-history', null, () => client.fastingHistory(), null);
      if (fasting) await this.saveAccountSnapshot(em, account, 'fasting', { items: fasting });
    }

    if (datasets.has('activity')) {
      const summary = await attempt('Активность', 'exercises-summary', null, () => client.exerciseSummary(from, to), []);
      if (summary.length > 0) {
        await em.upsertMany(
          DailyExercise,
          summary.map((day) => ({
            id: randomUUID(),
            account,
            date: dayOf(day.date),
            steps: day.steps ?? 0,
            duration: day.duration ?? 0,
            energy: day.energy ?? 0,
            fetchedAt: new Date(),
          })),
          {
            onConflictFields: ['account', 'date'],
            onConflictMergeFields: ['steps', 'duration', 'energy', 'fetchedAt'],
          },
        );
      }
    }

    // вес выгружается отдельно от прочих замеров: его отслеживают почти все,
    // а обхват груди — единицы, но стоят они одинаково — по запросу на вид
    const kinds = [
      ...(datasets.has('weight') ? (['weight'] as const) : []),
      ...(datasets.has('body-values') ? BODY_VALUE_KINDS.filter((k) => k !== 'weight') : []),
    ];

    for (const kind of kinds) {
      const values = await attempt('Замеры', 'body-values', kind, () => client.bodyValues(kind, from, to), []);
      if (values.length === 0) continue;

      await em.upsertMany(
        BodyValue,
        values.map((value) => ({
          id: randomUUID(),
          account,
          kind,
          loggedAt: value.date,
          date: dayOf(value.date),
          value: value.value ?? 0,
        })),
        {
          onConflictFields: ['account', 'kind', 'loggedAt'],
          onConflictMergeFields: ['date', 'value'],
        },
      );
    }

  }

  // ── доступ к данным ────────────────────────────────────────────────────────

  private async saveAccountSnapshot(
    em: EntityManager,
    account: Account,
    kind: AccountSnapshotKind,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await em.upsert(
      AccountSnapshot,
      { id: randomUUID(), account, kind, payload, fetchedAt: new Date() },
      {
        onConflictFields: ['account', 'kind'],
        onConflictMergeFields: ['payload', 'fetchedAt'],
      },
    );
  }

  /** Что уже есть в базе за период: итоги плюс признак наличия сырого снимка. */
  private async storedDays(
    em: EntityManager,
    accountId: string,
    from: string,
    to: string,
  ): Promise<StoredDay[]> {
    const rows = await em.getConnection().execute<
      Array<{
        date: string;
        energy: number;
        carb: number;
        protein: number;
        fat: number;
        energy_goal: number;
        has_snapshot: boolean;
      }>
    >(
      `select coalesce(n.date, s.date) as date,
              coalesce(n.energy, 0) as energy,
              coalesce(n.carb, 0) as carb,
              coalesce(n.protein, 0) as protein,
              coalesce(n.fat, 0) as fat,
              coalesce(n.energy_goal, 0) as energy_goal,
              (s.id is not null) as has_snapshot
         from daily_nutrients n
         full outer join day_snapshot s
           on s.account_id = n.account_id and s.date = n.date
        where coalesce(n.account_id, s.account_id) = ?
          and coalesce(n.date, s.date) between ? and ?`,
      [accountId, from, to],
    );

    return rows.map((row) => ({
      date: row.date,
      energy: Number(row.energy),
      carb: Number(row.carb),
      protein: Number(row.protein),
      fat: Number(row.fat),
      energyGoal: Number(row.energy_goal),
      hasSnapshot: Boolean(row.has_snapshot),
    }));
  }

  /**
   * Идентификаторы продуктов и рецептов, которые упомянуты в дневнике, но ещё
   * не выгружены. Разбор json делает PostgreSQL: тянуть в Node тысячи снимков
   * дня ради списка идентификаторов было бы расточительно.
   */
  private async missingIds(
    em: EntityManager,
    accountId: string,
    kind: 'product' | 'recipe',
  ): Promise<string[]> {
    const [jsonPath, idField, cacheTable, cacheColumn] =
      kind === 'product'
        ? ['products', 'product_id', 'product_cache', 'product_id']
        : ['recipe_portions', 'recipe_id', 'recipe_cache', 'recipe_id'];

    const rows = await em.getConnection().execute<Array<{ id: string }>>(
      `select distinct item->>'${idField}' as id
         from day_snapshot d,
              lateral jsonb_array_elements(coalesce(d.consumed->'${jsonPath}', '[]'::jsonb)) as item
        where d.account_id = ?
          and item->>'${idField}' is not null
          and not exists (
                select 1 from ${cacheTable} c
                 where c.account_id = d.account_id
                   and c.${cacheColumn} = item->>'${idField}')`,
      [accountId],
    );

    return rows.map((row) => row.id);
  }

  private async saveWarnings(
    em: EntityManager,
    run: SyncRun,
    warnings: SyncWarningDto[],
  ): Promise<void> {
    if (warnings.length === 0) return;
    // повторный прогон того же запуска невозможен, поэтому просто дописываем
    for (const warning of warnings) {
      em.create(SyncWarning, {
        run,
        phase: warning.phase,
        endpoint: warning.endpoint,
        key: warning.key,
        kind: warning.kind,
        status: warning.status,
        message: warning.message.slice(0, 2000),
        createdAt: new Date(),
      });
    }
  }

  private toDto(run: SyncRun): SyncRunDto {
    return {
      id: run.id,
      accountId: run.account.id,
      mode: run.mode,
      status: run.status,
      phase: run.phase,
      from: run.dateFrom,
      to: run.dateTo,
      datasets: run.datasets,
      daysTotal: run.daysTotal,
      daysDone: run.daysDone,
      requests: run.requests,
      warningsCount: run.warningsCount,
      error: run.error,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
    };
  }
}
