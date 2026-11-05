import { Module } from '@nestjs/common';
import { WorkerRegistryModule } from '../workers/registry.module.js';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';

@Module({
  imports: [WorkerRegistryModule],
  controllers: [CardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
