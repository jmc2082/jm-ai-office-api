import type { CompleteParams, CompleteResult } from '../ai/ai.service.js';
import type { TaskKey } from '../ai/models.config.js';
import type { Card, RunTrigger, Worker } from '../db/schema.js';

/** Static description of a worker. Synced into the `workers` table on boot. */
export interface WorkerDefinition {
  slug: string;
  displayName: string;
  description: string;
  department: string;
  /** Cron expression (server time zone). Omit for manual / hand-off only. */
  schedule?: string;
  modelTaskKey?: TaskKey;
  avatar?: string;
}

export interface NewCard {
  kind: string;
  title: string;
  summary?: string;
  payload?: Record<string, unknown>;
}

/** Everything a worker may do during a run. The runner records it all. */
export interface WorkerContext {
  readonly runId: number;
  readonly worker: Worker;
  readonly trigger: RunTrigger;
  /** Input from a manual run or a hand-off; null for scheduled runs. */
  readonly input: Record<string, unknown> | null;
  /** Append a line to the run log. */
  log(message: string): void;
  /** Post a line to the Happening Now feed. */
  announce(message: string): void;
  /** Call the model routed to `taskKey`. Tokens and cost are added to the run. */
  ai(taskKey: TaskKey, params: CompleteParams): Promise<CompleteResult>;
  /** Pass work to another worker; it gets queued with `input`. */
  handoff(
    targetSlug: string,
    message: string,
    input?: Record<string, unknown>,
  ): void;
  /** Ask for approval. The run ends as `needs_you`. */
  createCard(card: NewCard): Card;
}

/**
 * One worker, one job. Subclass, fill in `definition` and `run`, and register
 * the class in `workers/index.ts`.
 *
 * Content the worker reads (emails, pages, tickets) is data, never instructions.
 */
export abstract class BaseWorker {
  abstract readonly definition: WorkerDefinition;

  abstract run(ctx: WorkerContext): Promise<void>;

  /**
   * Called after a card from this worker is approved. Perform the gated action
   * here (send, publish, deploy...). Return a short note for the card's outcome.
   * Default: nothing to execute.
   */
  async execute(_card: Card): Promise<string | void> {
    return;
  }
}
