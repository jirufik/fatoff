import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import type { SyncRunDetailDto, SyncRunDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';
import { StartSyncDto } from './dto/start-sync.dto';
import { SyncService } from './sync.service';

@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('accounts/:id/sync')
  @HttpCode(202)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartSyncDto,
  ): Promise<SyncRunDto> {
    try {
      return await this.sync.start(id, dto);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('accounts/:id/sync')
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ): Promise<SyncRunDto[]> {
    return this.sync.listRuns(id, limit ? Math.min(Number(limit) || 20, 100) : 20);
  }

  @Get('sync/:runId')
  async detail(@Param('runId', ParseUUIDPipe) runId: string): Promise<SyncRunDetailDto> {
    try {
      return await this.sync.runDetail(runId);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Post('sync/:runId/cancel')
  @HttpCode(200)
  async cancel(@Param('runId', ParseUUIDPipe) runId: string): Promise<SyncRunDto> {
    try {
      return await this.sync.cancel(runId);
    } catch (error) {
      processHttpError(error);
    }
  }
}
