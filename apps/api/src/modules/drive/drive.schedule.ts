import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AppConfigService } from '../../config/app-config.service';
import { Account } from '../../database/entities';

import { DriveService } from './drive.service';

/**
 * Ежедневная проверка папки Drive.
 *
 * Задача одна на все аккаунты и просыпается каждую минуту, а не заводится по
 * задаче на аккаунт. Так проще там, где это важно: время меняют прямо в
 * интерфейсе, и при отдельных задачах их пришлось бы снимать и перерегистрировать
 * на каждое сохранение настроек — с попаданием в момент, когда задача уже
 * выполняется. Здесь же настройки читаются в момент срабатывания, и менять их
 * можно когда угодно.
 *
 * Цена — один запрос в базу в минуту, ничего не делающий в остальные
 * тысяча четыреста тридцать девять раз.
 */
@Injectable()
export class DriveSchedule implements OnModuleInit {
  private readonly logger = new Logger(DriveSchedule.name);

  /** Что уже запускали сегодня: `<accountId>:<ГГГГ-ММ-ДД ЧЧ:ММ>`. */
  private readonly done = new Set<string>();

  constructor(
    private readonly em: EntityManager,
    private readonly cfg: AppConfigService,
    private readonly drive: DriveService,
  ) {}

  onModuleInit(): void {
    if (this.cfg.isTest) return;
    this.logger.log('Ежедневная проверка Google Drive включена: время задаётся в аккаунте');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.cfg.isTest) return;

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.toISOString().slice(0, 10);

    const accounts = await this.em.fork().find(Account, {
      driveEnabled: true,
      driveDailyAt: hhmm,
    });

    for (const account of accounts) {
      // защита от двух срабатываний в одну минуту: часы могут дёрнуться назад
      const key = `${account.id}:${day} ${hhmm}`;
      if (this.done.has(key)) continue;
      this.done.add(key);

      try {
        const result = await this.drive.check(account.id, 'schedule');
        this.logger.log(`Проверка Drive для ${account.id}: ${result.status}`);
      } catch (error) {
        this.logger.error(`Проверка Drive для ${account.id} упала: ${String(error)}`);
      }
    }

    // множество не должно расти вечно: вчерашние ключи больше не нужны
    if (this.done.size > 64) {
      for (const key of this.done) if (!key.includes(day)) this.done.delete(key);
    }
  }
}
