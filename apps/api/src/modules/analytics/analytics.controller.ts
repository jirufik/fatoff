import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import type { AccountOverviewDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';
import { AnalyticsService } from './analytics.service';

@Controller('accounts')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':id/overview')
  async overview(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AccountOverviewDto> {
    try {
      return await this.analytics.overview(id, from, to);
    } catch (error) {
      processHttpError(error);
    }
  }
}
