import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import { cards, workers, type Card, type CardStatus } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import type { NewCard } from '../workers/worker.base.js';
import { WorkerRegistry } from '../workers/worker.registry.js';

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly events: EventsService,
    private readonly registry: WorkerRegistry,
  ) {}

  create(workerId: number, runId: number | null, card: NewCard): Card {
    const row = this.db
      .insert(cards)
      .values({
        workerId,
        runId,
        kind: card.kind,
        title: card.title,
        summary: card.summary ?? '',
        payload: card.payload ?? null,
      })
      .returning()
      .get();
    const name = this.workerName(workerId);
    this.events.emit({
      type: 'card_created',
      workerId,
      runId,
      message: `${name} put "${card.title}" in front of you`,
    });
    return row;
  }

  list(opts: { status?: CardStatus; limit?: number; before?: number } = {}) {
    const where: SQL[] = [];
    if (opts.status) where.push(eq(cards.status, opts.status));
    if (opts.before) where.push(lt(cards.id, opts.before));
    return this.db
      .select({
        card: cards,
        worker: {
          slug: workers.slug,
          displayName: workers.displayName,
          avatar: workers.avatar,
        },
      })
      .from(cards)
      .innerJoin(workers, eq(workers.id, cards.workerId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(cards.id))
      .limit(Math.min(opts.limit ?? 50, 200))
      .all()
      .map(({ card, worker }) => ({ ...card, worker }));
  }

  get(id: number): Card {
    const row = this.db.select().from(cards).where(eq(cards.id, id)).get();
    if (!row) throw new NotFoundException(`Card ${id} not found`);
    return row;
  }

  reject(id: number, note?: string): Card {
    const card = this.requireOpen(id);
    const row = this.resolve(card, 'rejected', note ?? null);
    this.events.emit({
      type: 'card_resolved',
      workerId: card.workerId,
      runId: card.runId,
      message: `You rejected "${card.title}"`,
    });
    return row;
  }

  /** Approve, then run the worker's gated action. */
  async approve(id: number, note?: string): Promise<Card> {
    const card = this.requireOpen(id);
    this.resolve(card, 'approved', note ?? null);

    const workerRow = this.db
      .select()
      .from(workers)
      .where(eq(workers.id, card.workerId))
      .get();
    const worker = workerRow ? this.registry.get(workerRow.slug) : undefined;

    let status: CardStatus = 'executed';
    let outcome = note ?? '';
    try {
      const result = worker
        ? await worker.execute(card)
        : 'No worker code to execute; marked done.';
      if (result) outcome = [note, result].filter(Boolean).join(' — ');
    } catch (err) {
      status = 'failed';
      outcome = [note, `Execution failed: ${(err as Error).message}`]
        .filter(Boolean)
        .join(' — ');
      this.logger.error(`Card ${id} execution failed`, err as Error);
    }

    const row = this.resolve(card, status, outcome || null);
    this.events.emit({
      type: 'card_resolved',
      workerId: card.workerId,
      runId: card.runId,
      message:
        status === 'executed'
          ? `You approved "${card.title}"`
          : `"${card.title}" was approved but failed to execute`,
    });
    return row;
  }

  private requireOpen(id: number): Card {
    const card = this.get(id);
    if (card.status !== 'open')
      throw new BadRequestException(`Card ${id} is already ${card.status}`);
    return card;
  }

  private resolve(card: Card, status: CardStatus, note: string | null): Card {
    return this.db
      .update(cards)
      .set({ status, resolutionNote: note, resolvedAt: new Date() })
      .where(eq(cards.id, card.id))
      .returning()
      .get();
  }

  private workerName(workerId: number): string {
    return (
      this.db
        .select({ n: workers.displayName })
        .from(workers)
        .where(eq(workers.id, workerId))
        .get()?.n ?? 'A worker'
    );
  }
}
