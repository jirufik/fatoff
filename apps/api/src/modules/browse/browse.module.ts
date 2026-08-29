import { Module } from '@nestjs/common';

import { AppleHealthModule } from '../apple-health/apple-health.module';

import { BrowseController } from './browse.controller';
import { BrowseService } from './browse.service';

@Module({
  imports: [AppleHealthModule],
  controllers: [BrowseController],
  providers: [BrowseService],
  exports: [BrowseService],
})
export class BrowseModule {}
