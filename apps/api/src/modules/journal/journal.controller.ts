import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import type { JournalDayDetailDto, JournalDayDto, PageDto } from '@fatoff/contracts';

import { assertIsoDate } from '../../common/date.util';
import { processHttpError } from '../../common/error-patterns';

import { JournalQueryDto } from './dto/journal-query.dto';
import { JournalService } from './journal.service';

@Controller('accounts/:id/journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get('days')
  async days(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: JournalQueryDto,
  ): Promise<PageDto<JournalDayDto>> {
    try {
      return await this.journal.days(id, query);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('days/:date')
  async day(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date') date: string,
  ): Promise<JournalDayDetailDto> {
    try {
      return await this.journal.day(id, assertIsoDate(date, 'Дата дня'));
    } catch (error) {
      processHttpError(error);
    }
  }
}
