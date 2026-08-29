import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';

import type { DriveFetchDto, DriveSettingsDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';

import { DriveSettingsBodyDto } from './dto/drive-settings.dto';
import { DriveService } from './drive.service';

@Controller('accounts/:id/drive')
export class DriveController {
  constructor(private readonly drive: DriveService) {}

  @Get('settings')
  async settings(@Param('id', ParseUUIDPipe) id: string): Promise<DriveSettingsDto> {
    try {
      return await this.drive.settings(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Patch('settings')
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DriveSettingsBodyDto,
  ): Promise<DriveSettingsDto> {
    try {
      return await this.drive.saveSettings(id, body);
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Кнопка «Загрузить»: сходить в папку прямо сейчас. */
  @Post('check')
  @HttpCode(202)
  async check(@Param('id', ParseUUIDPipe) id: string): Promise<DriveFetchDto> {
    try {
      return await this.drive.check(id, 'manual');
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('fetches')
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ): Promise<DriveFetchDto[]> {
    try {
      return await this.drive.history(id, limit ? Number(limit) : undefined);
    } catch (error) {
      processHttpError(error);
    }
  }
}
