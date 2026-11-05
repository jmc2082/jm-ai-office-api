import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import { workers, type Worker } from '../db/schema.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import type { UpdateWorkerDto } from './dto/update-worker.dto.js';

export interface WorkerSummary extends Worker {
  lastRun: {
    id: number;
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
  } | null;
  openCards: number;
  runsToday: number;
  costToday: number;
  nextRunAt: Date | null;
}

@Injectable()
export class WorkersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly scheduler: SchedulerService,
  ) {}

  list(since: Date): WorkerSummary[] {
    const rows = this.db
      .select()
      .from(workers)
      .orderBy(asc(workers.department), asc(workers.displayName))
      .all();
    return rows.map((w) => this.summarize(w, since));
  }

  get(idOrSlug: string, since: Date): WorkerSummary {
    const w = this.find(idOrSlug);
    return this.summarize(w, since);
  }

  update(idOrSlug: string, dto: UpdateWorkerDto): Worker {
    const w = this.find(idOrSlug);
    const row = this.db
      .update(workers)
      .set(dto)
      .where(eq(workers.id, w.id))
      .returning()
      .get();
    this.scheduler.refresh();
    return row;
  }

  find(idOrSlug: string): Worker {
    const isId = /^\d+$/.test(idOrSlug);
    const w = this.db
      .select()
      .from(workers)
      .where(
        isId ? eq(workers.id, Number(idOrSlug)) : eq(workers.slug, idOrSlug),
      )
      .get();
    if (!w) throw new NotFoundException(`Worker "${idOrSlug}" not found`);
    return w;
  }

  private summarize(w: Worker, since: Date): WorkerSummary {
    const sinceMs = since.getTime();
    const last = this.db.get<{
      id: number;
      status: string;
      startedAt: number | null;
      finishedAt: number | null;
    }>(sql`
      select id, status, started_at as startedAt, finished_at as finishedAt
      from runs where worker_id = ${w.id} order by id desc limit 1`);
    const toDate = (ms: number | null) => (ms == null ? null : new Date(ms));
    const lastRun = last
      ? {
          id: last.id,
          status: last.status,
          startedAt: toDate(last.startedAt),
          finishedAt: toDate(last.finishedAt),
        }
      : null;
    const agg = this.db.get<{
      openCards: number;
      runsToday: number;
      costToday: number;
    }>(sql`
      select
        (select count(*) from cards where worker_id = ${w.id} and status = 'open') as openCards,
        (select count(*) from runs where worker_id = ${w.id} and queued_at >= ${sinceMs}) as runsToday,
        (select round(coalesce(sum(cost_usd), 0), 6) from runs where worker_id = ${w.id} and queued_at >= ${sinceMs}) as costToday`);
    return {
      ...w,
      lastRun,
      openCards: agg?.openCards ?? 0,
      runsToday: agg?.runsToday ?? 0,
      costToday: agg?.costToday ?? 0,
      nextRunAt: this.scheduler.nextRun(w.slug),
    };
  }
}
