import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import type {
  DayRowDto,
  DiaryRowDto,
  HealthDayRowDto,
  HealthSleepRowDto,
  HealthWorkoutRowDto,
  MeasurementRowDto,
  PageDto,
  ProductRowDto,
} from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';
import { BrowseService } from './browse.service';
import {
  DayQueryDto,
  DiaryQueryDto,
  MeasurementQueryDto,
  ProductQueryDto,
} from './dto/browse-query.dto';

@Controller('accounts/:id/data')
export class BrowseController {
  constructor(private readonly browse: BrowseService) {}

  @Get('diary')
  async diary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DiaryQueryDto,
  ): Promise<PageDto<DiaryRowDto>> {
    try {
      return await this.browse.diary(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('days')
  async days(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DayQueryDto,
  ): Promise<PageDto<DayRowDto>> {
    try {
      return await this.browse.days(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('products')
  async products(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ProductQueryDto,
  ): Promise<PageDto<ProductRowDto>> {
    try {
      return await this.browse.products(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('health')
  async health(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DayQueryDto,
  ): Promise<PageDto<HealthDayRowDto>> {
    try {
      return await this.browse.healthDays(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('workouts')
  async workouts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DayQueryDto,
  ): Promise<PageDto<HealthWorkoutRowDto>> {
    try {
      return await this.browse.healthWorkouts(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('sleep')
  async sleep(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DayQueryDto,
  ): Promise<PageDto<HealthSleepRowDto>> {
    try {
      return await this.browse.healthSleep(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('measurements')
  async measurements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MeasurementQueryDto,
  ): Promise<PageDto<MeasurementRowDto>> {
    try {
      return await this.browse.measurements(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }
}
