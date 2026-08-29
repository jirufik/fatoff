import { Module } from '@nestjs/common';

import { AppleHealthModule } from '../apple-health/apple-health.module';

import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportLoader } from './loader';

@Module({
  imports: [AppleHealthModule],
  controllers: [ExportsController],
  providers: [ExportsService, ExportLoader],
  exports: [ExportsService],
})
export class ExportsModule {}
