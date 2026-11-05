import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import { workers } from '../db/schema.js';
import { WorkerRunnerService } from '../workers/worker-runner.service.js';

const PREFIX = 'worker:';

/** Creates one cron job per enabled, implemented worker that has a schedule. */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: SchedulerRegistry,
    private readonly runner: WorkerRunnerService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get<boolean>('schedulerEnabled')) {
      this.logger.warn('Scheduler disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    this.refresh();
  }

  /** Rebuild all worker cron jobs from the database. Call after enabling/disabling a worker. */
  refresh() {
    if (!this.config.get<boolean>('schedulerEnabled')) return;
    for (const name of this.registry.getCronJobs().keys()) {
      if (name.startsWith(PREFIX)) this.registry.deleteCronJob(name);
    }
    const rows = this.db
      .select()
      .from(workers)
      .where(eq(workers.implemented, true))
      .all();
    for (const w of rows) {
      if (
        !w.schedule ||
        !w.enabled ||
        w.status === 'paused' ||
        w.status === 'retired'
      )
        continue;
      const job = CronJob.from({
        cronTime: w.schedule,
        onTick: () => {
          try {
            this.runner.enqueue(w.slug, 'schedule');
          } catch (err) {
            this.logger.error(
              `Scheduled enqueue failed for ${w.slug}`,
              err as Error,
            );
          }
        },
        start: false,
      });
      this.registry.addCronJob(`${PREFIX}${w.slug}`, job);
      job.start();
      this.logger.log(`Scheduled ${w.slug} (${w.schedule})`);
    }
  }

  nextRun(slug: string): Date | null {
    try {
      const job = this.registry.getCronJob(`${PREFIX}${slug}`);
      return job.nextDate().toJSDate();
    } catch {
      return null;
    }
  }
}
