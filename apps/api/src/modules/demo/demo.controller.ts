import { Body, Controller, Get, Post } from '@nestjs/common';

import type { AccountDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';

import { CreateDemoDto } from './dto/create-demo.dto';
import { DemoService } from './demo.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  /** Есть ли уже демо: страница выбора аккаунтов зовёт открыть, а не плодить. */
  @Get()
  find(): Promise<AccountDto | null> {
    return this.demo.find();
  }

  @Post()
  async create(@Body() body: CreateDemoDto): Promise<AccountDto> {
    try {
      return await this.demo.generate(body.locale ?? 'ru');
    } catch (error) {
      processHttpError(error);
    }
  }
}
