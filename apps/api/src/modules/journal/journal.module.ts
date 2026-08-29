import { Module } from '@nestjs/common';

import { PlannerModule } from '../planner/planner.module';

import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  imports: [PlannerModule],
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
