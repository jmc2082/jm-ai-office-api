import { Module } from '@nestjs/common';
import { CardsModule } from '../cards/cards.module.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { WorkerRegistryModule } from './registry.module.js';
import { WorkerRunnerService } from './worker-runner.service.js';
import { WorkersController } from './workers.controller.js';
import { WorkersService } from './workers.service.js';

@Module({
  imports: [WorkerRegistryModule, CardsModule],
  controllers: [WorkersController],
  providers: [WorkersService, WorkerRunnerService, SchedulerService],
  exports: [WorkerRunnerService],
})
export class WorkersModule {}
