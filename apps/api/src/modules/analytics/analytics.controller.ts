import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import type { AccountOverviewDto, HomeDto, PeriodSummaryDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';
import { AnalyticsService } from './analytics.service';

@Controller('accounts')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Главный экран: баланс последнего полного дня, питание за сегодня, неделя
   * тренировок и свежесть данных.
   *
   * «Сегодня» присылает браузер: сервер в контейнере живёт по UTC, а после
   * полуночи по Москве его «сегодня» ещё три часа было бы вчерашним днём.
   */
  @Get(':id/home')
  async home(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('today') today?: string,
  ): Promise<HomeDto> {
    try {
      return await this.analytics.home(id, today);
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Сводка за период для главного экрана; без дат — последние семь дней. */
  @Get(':id/summary')
  async summary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PeriodSummaryDto> {
    try {
      return await this.analytics.summary(id, from, to);
    } catch (error) {
      processHttpError(error);
    }
  }

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
