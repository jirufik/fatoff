import { Module } from '@nestjs/common';

import { ExportsModule } from '../exports/exports.module';
import { SyncModule } from '../sync/sync.module';
import { ScheduleService } from './schedule.service';
import { SyncSchedule } from './sync.schedule';

@Module({
  imports: [SyncModule, ExportsModule],
  providers: [ScheduleService, SyncSchedule],
})
export class SyncScheduleModule {}
