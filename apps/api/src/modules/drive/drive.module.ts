import { Module } from '@nestjs/common';

import { AppleHealthModule } from '../apple-health/apple-health.module';

import { DriveController } from './drive.controller';
import { DriveSchedule } from './drive.schedule';
import { DriveService } from './drive.service';

/**
 * Загрузка выгрузки Apple Health из папки Google Drive.
 *
 * Отдельный модуль намеренно: разбор XML к Drive отношения не имеет, а Drive —
 * к разбору. Связь одна и в одну сторону — модуль зовёт готовую загрузку.
 */
@Module({
  imports: [AppleHealthModule],
  controllers: [DriveController],
  providers: [DriveService, DriveSchedule],
  exports: [DriveService],
})
export class DriveModule {}
