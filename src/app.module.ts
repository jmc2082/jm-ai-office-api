import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from './ai/ai.module.js';
import { CognitoAuthGuard } from './auth/cognito-auth.guard.js';
import { CardsModule } from './cards/cards.module.js';
import configuration from './config/configuration.js';
import { DbModule } from './db/db.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { MailModule } from './mail/mail.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RunsModule } from './runs/runs.module.js';
import { StatsModule } from './stats/stats.module.js';
import { WikiModule } from './wiki/wiki.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    ScheduleModule.forRoot(),
    DbModule,
    AiModule,
    EventsModule,
    MailModule,
    QueueModule,
    CardsModule,
    WorkersModule,
    RunsModule,
    StatsModule,
    WikiModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: CognitoAuthGuard }],
})
export class AppModule {}
