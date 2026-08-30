import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { PlannerModule } from '../planner/planner.module';

import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

/**
 * Демо-аккаунт: сервис, наполненный выдуманной историей.
 *
 * Отдельный модуль, а не ручка в аккаунтах: наполнение знает про дневник,
 * продукты, сон и тренировки — то есть почти про всю базу, — и тащить это
 * знание в модуль, чья работа сводится к учётным записям, значило бы сделать
 * его модулем обо всём.
 */
@Module({
  imports: [AccountsModule, PlannerModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
