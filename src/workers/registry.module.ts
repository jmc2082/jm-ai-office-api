import { Module } from '@nestjs/common';
import { WORKER_CLASSES } from './index.js';
import { WorkerRegistry } from './worker.registry.js';

@Module({
  providers: [...WORKER_CLASSES, WorkerRegistry],
  exports: [WorkerRegistry],
})
export class WorkerRegistryModule {}
