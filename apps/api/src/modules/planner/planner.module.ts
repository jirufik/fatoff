import { Module } from '@nestjs/common';

import { AccountFactsService } from './facts.service';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

@Module({
  controllers: [PlannerController],
  providers: [AccountFactsService, PlannerService],
  exports: [AccountFactsService, PlannerService],
})
export class PlannerModule {}
