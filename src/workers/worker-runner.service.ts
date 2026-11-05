import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AiService } from '../ai/ai.service.js';
import { addUsage, emptyUsage } from '../ai/cost.js';
import { CardsService } from '../cards/cards.service.js';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import {
  runs,
  workers,
  type Run,
  type RunTrigger,
  type Worker,
} from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { QueueService } from '../queue/queue.service.js';
import type { BaseWorker, WorkerContext } from './worker.base.js';
import { WorkerRegistry } from './worker.registry.js';

const MAX_LOG_CHARS = 200_000;

/**
 * Owns the run lifecycle (roadmap §3):
 * queued → running → ok | needs_you | failed, with tokens, cost and log on the row.
 */
@Injectable()
export class WorkerRunnerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerRunnerService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: WorkerRegistry,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly cards: CardsService,
    private readonly ai: AiService,
  ) {}

  onModuleInit() {
    this.syncDefinitions();
    this.recoverInterruptedRuns();
  }

  /** Code is the source of truth for definitions; `enabled` and `status` stay as set in the UI. */
  syncDefinitions() {
    for (const w of this.registry.all()) {
      const d = w.definition;
      const values = {
        displayName: d.displayName,
        description: d.description,
        department: d.department,
        schedule: d.schedule ?? null,
        modelTaskKey: d.modelTaskKey ?? null,
        avatar: d.avatar ?? null,
        implemented: true,
      };
      this.db
        .insert(workers)
        .values({ slug: d.slug, ...values })
        .onConflictDoUpdate({ target: workers.slug, set: values })
        .run();
    }
  }

  /** Runs left `queued`/`running` by a crash or restart can never finish; mark them failed. */
  private recoverInterruptedRuns() {
    const stuck = this.db
      .update(runs)
      .set({
        status: 'failed',
        error: 'Interrupted by server restart',
        finishedAt: new Date(),
      })
      .where(inArray(runs.status, ['queued', 'running']))
      .returning({ id: runs.id })
      .all();
    if (stuck.length)
      this.logger.warn(`Marked ${stuck.length} interrupted run(s) as failed`);
  }

  /** Queue a run. Returns the `queued` run row, or null if a scheduled run was skipped. */
  enqueue(
    slug: string,
    trigger: RunTrigger,
    input: Record<string, unknown> | null = null,
  ): Run | null {
    const workerRow = this.db
      .select()
      .from(workers)
      .where(eq(workers.slug, slug))
      .get();
    if (!workerRow) throw new NotFoundException(`Worker "${slug}" not found`);
    const impl = this.registry.get(slug);
    if (!impl)
      throw new BadRequestException(`Worker "${slug}" has no code behind it`);

    if (trigger !== 'manual') {
      if (
        !workerRow.enabled ||
        workerRow.status === 'paused' ||
        workerRow.status === 'retired'
      ) {
        this.logger.debug(`Skipping ${trigger} run for ${slug}: not active`);
        return null;
      }
    }
    if (trigger === 'schedule' && this.hasActiveRun(workerRow.id)) {
      this.logger.debug(
        `Skipping scheduled run for ${slug}: previous run still active`,
      );
      return null;
    }

    const run = this.db
      .insert(runs)
      .values({ workerId: workerRow.id, trigger, input })
      .returning()
      .get();
    this.queue.add(() => this.execute(run.id, workerRow, impl));
    return run;
  }

  private hasActiveRun(workerId: number): boolean {
    return !!this.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.workerId, workerId),
          inArray(runs.status, ['queued', 'running']),
        ),
      )
      .get();
  }

  private async execute(
    runId: number,
    workerRow: Worker,
    impl: BaseWorker,
  ): Promise<void> {
    const run = this.db
      .update(runs)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(runs.id, runId))
      .returning()
      .get();
    const name = workerRow.displayName;
    this.events.emit({
      type: 'run_started',
      workerId: workerRow.id,
      runId,
      message: `${name} started a run`,
    });

    const logLines: string[] = [];
    let usage = emptyUsage();
    let costUsd = 0;
    const models = new Set<string>();
    let cardsCreated = 0;
    const handoffs: Array<{
      slug: string;
      message: string;
      input?: Record<string, unknown>;
    }> = [];

    const log = (message: string) =>
      logLines.push(`[${new Date().toISOString()}] ${message}`);

    const ctx: WorkerContext = {
      runId,
      worker: workerRow,
      trigger: run.trigger,
      input: run.input ?? null,
      log,
      announce: (message) =>
        this.events.emit({
          type: 'info',
          workerId: workerRow.id,
          runId,
          message: `${name} ${message}`,
        }),
      ai: async (taskKey, params) => {
        const result = await this.ai.complete(taskKey, params);
        usage = addUsage(usage, result.usage);
        costUsd += result.costUsd;
        models.add(result.model);
        log(
          `AI ${taskKey} (${result.model}, prompt ${result.promptVersion}): ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, $${result.costUsd.toFixed(6)}`,
        );
        return result;
      },
      // Hand-offs are queued only after this run succeeds, so a failed run never triggers downstream work.
      handoff: (slug, message, input) => {
        if (!this.registry.get(slug))
          throw new Error(`Unknown hand-off target "${slug}"`);
        handoffs.push({ slug, message, input });
        log(`Hand-off to ${slug}: ${message}`);
      },
      createCard: (card) => {
        cardsCreated++;
        log(`Card created: ${card.title}`);
        return this.cards.create(workerRow.id, runId, card);
      },
    };

    try {
      await impl.run(ctx);
      const status = cardsCreated > 0 ? 'needs_you' : 'ok';
      this.finish(runId, { status, usage, costUsd, models, logLines });
      this.events.emit({
        type: 'run_finished',
        workerId: workerRow.id,
        runId,
        message:
          status === 'needs_you'
            ? `${name} finished and needs you`
            : `${name} finished a run clean`,
      });
      for (const h of handoffs) this.dispatchHandoff(workerRow, runId, h);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${message}`);
      this.finish(runId, {
        status: 'failed',
        usage,
        costUsd,
        models,
        logLines,
        error: message,
      });
      this.events.emit({
        type: 'run_failed',
        workerId: workerRow.id,
        runId,
        message: `${name} failed: ${message}`,
      });
      this.logger.error(
        `Run ${runId} (${workerRow.slug}) failed`,
        err as Error,
      );
    }
  }

  private dispatchHandoff(
    from: Worker,
    runId: number,
    h: { slug: string; message: string; input?: Record<string, unknown> },
  ) {
    const target = this.db
      .select()
      .from(workers)
      .where(eq(workers.slug, h.slug))
      .get();
    if (!target) return;
    this.events.emit({
      type: 'handoff',
      workerId: from.id,
      runId,
      targetWorkerId: target.id,
      message: `${from.displayName} ${h.message}`,
    });
    try {
      const queued = this.enqueue(h.slug, 'handoff', {
        ...h.input,
        fromRunId: runId,
        fromWorker: from.slug,
      });
      if (!queued) {
        this.events.emit({
          type: 'info',
          workerId: target.id,
          message: `${target.displayName} is paused; hand-off not picked up`,
        });
      }
    } catch (err) {
      this.logger.error(
        `Hand-off ${from.slug} → ${h.slug} failed`,
        err as Error,
      );
    }
  }

  private finish(
    runId: number,
    r: {
      status: Run['status'];
      usage: ReturnType<typeof emptyUsage>;
      costUsd: number;
      models: Set<string>;
      logLines: string[];
      error?: string;
    },
  ) {
    let log = r.logLines.join('\n');
    if (log.length > MAX_LOG_CHARS)
      log = `${log.slice(0, MAX_LOG_CHARS)}\n…[truncated]`;
    this.db
      .update(runs)
      .set({
        status: r.status,
        finishedAt: new Date(),
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        cacheReadTokens: r.usage.cacheReadTokens,
        cacheWriteTokens: r.usage.cacheWriteTokens,
        costUsd: Math.round(r.costUsd * 1_000_000) / 1_000_000,
        model: r.models.size ? [...r.models].join(',') : null,
        log,
        error: r.error ?? null,
      })
      .where(eq(runs.id, runId))
      .run();
  }
}
