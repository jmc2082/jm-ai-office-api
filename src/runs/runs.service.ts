import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import { cards, events, runs, workers, type RunStatus } from '../db/schema.js';

@Injectable()
export class RunsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** List view omits the (potentially large) log. */
  list(
    opts: {
      workerId?: number;
      status?: RunStatus;
      limit?: number;
      before?: number;
    } = {},
  ) {
    const where: SQL[] = [];
    if (opts.workerId) where.push(eq(runs.workerId, opts.workerId));
    if (opts.status) where.push(eq(runs.status, opts.status));
    if (opts.before) where.push(lt(runs.id, opts.before));
    return this.db
      .select({
        id: runs.id,
        workerId: runs.workerId,
        trigger: runs.trigger,
        status: runs.status,
        queuedAt: runs.queuedAt,
        startedAt: runs.startedAt,
        finishedAt: runs.finishedAt,
        inputTokens: runs.inputTokens,
        outputTokens: runs.outputTokens,
        costUsd: runs.costUsd,
        model: runs.model,
        error: runs.error,
        worker: {
          slug: workers.slug,
          displayName: workers.displayName,
          avatar: workers.avatar,
        },
      })
      .from(runs)
      .innerJoin(workers, eq(workers.id, runs.workerId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(runs.id))
      .limit(Math.min(opts.limit ?? 50, 200))
      .all();
  }

  get(id: number) {
    const run = this.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return {
      ...run,
      cards: this.db.select().from(cards).where(eq(cards.runId, id)).all(),
      events: this.db
        .select()
        .from(events)
        .where(eq(events.runId, id))
        .orderBy(events.id)
        .all(),
    };
  }
}
