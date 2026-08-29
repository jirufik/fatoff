import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { hhmmOf, OncePerMinute } from '../../common/daily-at';
import { AppConfigService } from '../../config/app-config.service';
import { Account, SyncRun } from '../../database/entities';
import { SyncService } from '../sync/sync.service';

/**
 * Синхронизация YAZIO в своё время у каждого аккаунта.
 *
 * Раньше время было одно на всех — `SYNC_CRON`, три часа ночи. Общего
 * расписания больше нет: у аккаунтов разные хозяева и разные привычки, и час,
 * удобный одному, другому не подходит — телефон может быть выключен, а данные
 * за день дописываться поздно вечером.
 *
 * Устройство ровно то же, что у проверки папки Google Drive: время в аккаунте,
 * задача просыпается каждую минуту и смотрит, чьё время настало.
 */
@Injectable()
export class SyncSchedule {
  private readonly logger = new Logger(SyncSchedule.name);
  private readonly once = new OncePerMinute();

  constructor(
    private readonly em: EntityManager,
    private readonly cfg: AppConfigService,
    private readonly sync: SyncService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.cfg.isTest || !this.cfg.get('SCHEDULES_ENABLED')) return;
    await this.runDue(new Date());
  }

  /** Чьё время настало. Публичный, чтобы тест мог назвать минуту сам. */
  async runDue(now: Date): Promise<string[]> {
    const em = this.em.fork();
    const accounts = await em.find(Account, {
      syncEnabled: true,
      syncDailyAt: hhmmOf(now),
    });

    const started: string[] = [];
    for (const account of accounts) {
      if (!this.once.claim(account.id, now)) continue;

      const active = await em.findOne(SyncRun, {
        account: account.id,
        status: { $in: ['queued', 'running'] },
      });
      if (active) {
        this.logger.warn(`Пропускаю ${account.id}: синхронизация уже идёт`);
        continue;
      }

      try {
        // по одному аккаунту за раз, как и в ночном прогоне: параллельная
        // выгрузка нескольких историй упрётся в лимиты YAZIO
        await this.sync.runNow(account.id, {});
        started.push(account.id);
      } catch (error) {
        this.logger.error(`Синхронизация ${account.id} по расписанию: ${String(error)}`);
      }
    }
    return started;
  }
}
