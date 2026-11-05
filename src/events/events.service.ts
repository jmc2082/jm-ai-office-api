import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, gte, and, lt, type SQL } from 'drizzle-orm';
import { Subject } from 'rxjs';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import { events, type EventRow, type EventType } from '../db/schema.js';

export interface EmitEvent {
  type: EventType;
  message: string;
  workerId?: number | null;
  runId?: number | null;
  targetWorkerId?: number | null;
}

/** Append-only event log. Every row is also pushed to live SSE subscribers. */
@Injectable()
export class EventsService {
  private readonly stream$ = new Subject<EventRow>();
  readonly live$ = this.stream$.asObservable();

  constructor(@Inject(DB) private readonly db: Db) {}

  emit(e: EmitEvent): EventRow {
    const row = this.db
      .insert(events)
      .values({
        type: e.type,
        message: e.message,
        workerId: e.workerId ?? null,
        runId: e.runId ?? null,
        targetWorkerId: e.targetWorkerId ?? null,
      })
      .returning()
      .get();
    this.stream$.next(row);
    return row;
  }

  list(
    opts: {
      limit?: number;
      since?: Date;
      before?: number;
      type?: EventType;
      workerId?: number;
    } = {},
  ) {
    const where: SQL[] = [];
    if (opts.since) where.push(gte(events.ts, opts.since));
    if (opts.before) where.push(lt(events.id, opts.before));
    if (opts.type) where.push(eq(events.type, opts.type));
    if (opts.workerId) where.push(eq(events.workerId, opts.workerId));
    return this.db
      .select()
      .from(events)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(events.id))
      .limit(Math.min(opts.limit ?? 50, 500))
      .all();
  }
}
