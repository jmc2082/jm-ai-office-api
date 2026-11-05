import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobQueue, type Job } from './job-queue.js';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly queue: JobQueue;

  constructor(config: ConfigService) {
    const concurrency = config.get<number>('queueConcurrency') ?? 2;
    this.queue = new JobQueue(concurrency, (err) =>
      this.logger.error('Job crashed', err as Error),
    );
  }

  add(job: Job) {
    this.queue.add(job);
  }

  get size() {
    return this.queue.size;
  }

  onIdle() {
    return this.queue.onIdle();
  }
}
