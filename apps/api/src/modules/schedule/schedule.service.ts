import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { AppConfigService } from '../../config/app-config.service';
import { Account, SyncRun } from '../../database/entities';
import { ExportsService } from '../exports/exports.service';
import { SyncService } from '../sync/sync.service';

const JOB_NAME = 'nightly-sync';

/**
 * Ночная синхронизация и уборка старых файлов.
 *
 * Расписание берётся из окружения, поэтому задача регистрируется вручную, а не
 * декоратором `@Cron`: пустое значение `SYNC_CRON` должно просто выключать её,
 * а не требовать правки кода.
 */
@Injectable()
export class ScheduleService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly cfg: AppConfigService,
    private readonly em: EntityManager,
    private readonly sync: SyncService,
    private readonly exports: ExportsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const expression = this.cfg.get('SYNC_CRON').trim();
    if (!expression || this.cfg.isTest) {
      this.logger.log('Автосинхронизация выключена: SYNC_CRON пуст');
      return;
    }

    try {
      const job = new CronJob(expression, () => void this.runNightly());
      this.scheduler.addCronJob(JOB_NAME, job as never);
      job.start();
      this.logger.log(`Автосинхронизация по расписанию: ${expression}`);
    } catch (error) {
      // неверное выражение не должно мешать сервису работать руками
      this.logger.error(`Не удалось поставить расписание «${expression}»: ${String(error)}`);
    }
  }

  /** Синхронизирует все включённые аккаунты по очереди и прибирает выгрузки. */
  async runNightly(): Promise<void> {
    const em = this.em.fork();
    const accounts = await em.find(Account, { syncEnabled: true });

    for (const account of accounts) {
      const active = await em.findOne(SyncRun, {
        account: account.id,
        status: { $in: ['queued', 'running'] },
      });
      if (active) {
        this.logger.warn(`Пропускаю ${account.email}: синхронизация уже идёт`);
        continue;
      }

      try {
        // по одному аккаунту за раз: параллельная выгрузка нескольких историй
        // упёрлась бы в лимиты YAZIO быстрее, чем сэкономила время
        await this.sync.runNow(account.id, {});
      } catch (error) {
        this.logger.error(`Автосинхронизация ${account.email}: ${String(error)}`);
      }
    }

    await this.exports.cleanup().catch((error: unknown) => {
      this.logger.error(`Уборка выгрузок: ${String(error)}`);
    });
  }
}
