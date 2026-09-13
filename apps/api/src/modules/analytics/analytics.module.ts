import { Module } from '@nestjs/common';

import { PlannerModule } from '../planner/planner.module';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  // нормы берутся у генератора: цель питания и норма белка на главном экране
  // обязаны совпасть с теми, что стоят в «Режиме»
  imports: [PlannerModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
