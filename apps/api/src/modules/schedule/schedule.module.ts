import { Module } from '@nestjs/common';

import { ExportsModule } from '../exports/exports.module';
import { SyncModule } from '../sync/sync.module';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [SyncModule, ExportsModule],
  providers: [ScheduleService],
})
export class SyncScheduleModule {}
