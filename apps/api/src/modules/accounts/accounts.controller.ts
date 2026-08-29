import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import type { AccountDto } from '@fatoff/contracts';

import { processHttpError } from '../../common/error-patterns';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): Promise<AccountDto[]> {
    return this.accounts.list();
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<AccountDto> {
    try {
      return await this.accounts.detail(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Post()
  async create(@Body() dto: CreateAccountDto): Promise<AccountDto> {
    try {
      return await this.accounts.create(dto);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountDto> {
    try {
      return await this.accounts.update(id, dto);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    try {
      await this.accounts.remove(id);
    } catch (error) {
      processHttpError(error);
    }
  }
}
