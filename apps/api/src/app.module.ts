import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import mikroOrmConfig from './database/mikro-orm.config';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { BrowseModule } from './modules/browse/browse.module';
import { AuthModule } from './modules/auth/auth.module';
import { ExportsModule } from './modules/exports/exports.module';
import { JournalModule } from './modules/journal/journal.module';
import { PlannerModule } from './modules/planner/planner.module';
import { AppleHealthModule } from './modules/apple-health/apple-health.module';
import { DriveModule } from './modules/drive/drive.module';
import { HealthModule } from './modules/health/health.module';
import { SyncScheduleModule } from './modules/schedule/schedule.module';
import { SyncModule } from './modules/sync/sync.module';
import { YazioModule } from './modules/yazio/yazio.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        pinoHttp: {
          level: cfg.get('LOG_LEVEL'),
          transport: cfg.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
          // ни пароль сервиса, ни пароль YAZIO, ни токены не должны попасть в лог
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.body.password',
            'password',
            'access_token',
            'refresh_token',
          ],
          autoLogging: { ignore: (req) => req.url === '/health' },
        },
      }),
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    MikroOrmModule.forRoot(mikroOrmConfig),

    AuthModule,
    YazioModule,
    HealthModule,
    AccountsModule,
    SyncModule,
    ExportsModule,
    AnalyticsModule,
    BrowseModule,
    AppleHealthModule,
    DriveModule,
    PlannerModule,
    JournalModule,
    SyncScheduleModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
