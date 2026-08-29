import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';

import type { ExportFileDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportsService } from './exports.service';

@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('accounts/:id/exports')
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExportDto,
  ): Promise<ExportFileDto> {
    try {
      return await this.exports.create(id, dto);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('exports')
  list(@Query('accountId') accountId?: string): Promise<ExportFileDto[]> {
    return this.exports.list(accountId);
  }

  @Get('exports/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ExportFileDto> {
    try {
      return await this.exports.detail(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('exports/:id/download')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    try {
      const { path, fileName } = await this.exports.fileFor(id);

      // имя файла может содержать кириллицу, поэтому кроме ASCII-запасного
      // варианта отдаётся форма RFC 5987 — иначе браузер сохранит «______.zip»
      const ascii = fileName.replace(/[^\x20-\x7e]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader('Content-Type', 'application/octet-stream');
      createReadStream(path).pipe(res);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Delete('exports/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    try {
      await this.exports.remove(id);
    } catch (error) {
      processHttpError(error);
    }
  }
}
