import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import { QueueService } from '../queue/queue.service.js';

const BUCKET_MS = 10 * 60 * 1000;

/** Dashboard numbers, all derived on read (roadmap §4). */
@Injectable()
export class StatsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queue: QueueService,
  ) {}

  summary(since: Date) {
    const s = since.getTime();
    const row = this.db.get<{
      workers: number;
      workingNow: number;
      needYou: number;
      broken: number;
      handoffsToday: number;
      runsToday: number;
      costToday: number;
    }>(sql`
      select
        (select count(*) from workers where enabled = 1 and status != 'retired') as workers,
        (select count(*) from runs where status = 'running') as workingNow,
        (select count(*) from cards where status = 'open') as needYou,
        (select count(*) from workers w
           where w.enabled = 1 and w.status != 'retired'
             and (select r.status from runs r
                  where r.worker_id = w.id and r.status in ('ok','failed','needs_you')
                  order by r.id desc limit 1) = 'failed') as broken,
        (select count(*) from events where type = 'handoff' and ts >= ${s}) as handoffsToday,
        (select count(*) from runs where queued_at >= ${s}) as runsToday,
        (select round(coalesce(sum(cost_usd), 0), 6) from runs where queued_at >= ${s}) as costToday`);
    return { ...row!, queue: this.queue.size, since };
  }

  /** Event counts per 10-minute bucket since `since`, for the Replay strip. */
  replay(since: Date) {
    const s = since.getTime();
    const rows = this.db.all<{
      bucket: number;
      events: number;
      handoffs: number;
    }>(sql`
      select cast(ts / ${BUCKET_MS} as integer) * ${BUCKET_MS} as bucket,
             count(*) as events,
             sum(case when type = 'handoff' then 1 else 0 end) as handoffs
      from events where ts >= ${s}
      group by bucket order by bucket`);
    return {
      bucketMs: BUCKET_MS,
      since,
      buckets: rows.map((r) => ({ ...r, bucket: new Date(r.bucket) })),
    };
  }

  /** Cost per day per worker for the last `days` days (UTC days). */
  cost(days: number) {
    const from = Date.now() - days * 86_400_000;
    return this.db.all<{
      day: string;
      workerId: number;
      slug: string;
      displayName: string;
      runs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
    }>(sql`
      select date(r.queued_at / 1000, 'unixepoch') as day,
             w.id as workerId, w.slug as slug, w.display_name as displayName,
             count(*) as runs,
             round(coalesce(sum(r.cost_usd), 0), 6) as costUsd,
             coalesce(sum(r.input_tokens), 0) as inputTokens,
             coalesce(sum(r.output_tokens), 0) as outputTokens
      from runs r join workers w on w.id = r.worker_id
      where r.queued_at >= ${from}
      group by day, w.id
      order by day desc, costUsd desc`);
  }
}
