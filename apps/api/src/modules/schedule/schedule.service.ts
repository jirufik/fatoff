import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AppConfigService } from '../../config/app-config.service';
import { ExportsService } from '../exports/exports.service';

/**
 * Уборка собранных файлов по сроку хранения.
 *
 * Всё, что осталось от общего ночного расписания. Синхронизация из него ушла:
 * у каждого аккаунта теперь своё время, как у проверки папки Drive (D-063).
 *
 * Уборка настройкой не стала намеренно — она к аккаунтам отношения не имеет.
 * Это обслуживание диска, и час его выполнения человеку неинтересен.
 */
@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly cfg: AppConfigService,
    private readonly exports: ExportsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup(): Promise<void> {
    if (this.cfg.isTest) return;

    await this.exports.cleanup().catch((error: unknown) => {
      this.logger.error(`Уборка выгрузок: ${String(error)}`);
    });
  }
}
