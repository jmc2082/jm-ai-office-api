import { Injectable } from '@nestjs/common';
import type { Card } from '../../db/schema.js';
import {
  BaseWorker,
  type WorkerContext,
  type WorkerDefinition,
} from '../worker.base.js';

/** Phase 0 reviewer: receives a hand-off, checks it, asks me to approve. */
@Injectable()
export class HelloReviewerWorker extends BaseWorker {
  readonly definition: WorkerDefinition = {
    slug: 'hello-reviewer',
    displayName: 'Proof',
    description:
      'Reviews drafts handed off by other workers and asks for approval.',
    department: 'quality',
    modelTaskKey: 'hello.review',
    avatar: 'proof',
  };

  async run(ctx: WorkerContext): Promise<void> {
    const draft = typeof ctx.input?.draft === 'string' ? ctx.input.draft : null;
    if (!draft) {
      ctx.log('No draft in input; nothing to review.');
      return;
    }

    // Deterministic check first (principle 3); the model only comments on tone.
    const tooLong = draft.length > 280;
    const review = await ctx.ai('hello.review', {
      system:
        'You review short dashboard greetings. Reply with one sentence of feedback. Plain text only.',
      messages: [{ role: 'user', content: `<draft>\n${draft}\n</draft>` }],
    });

    ctx.createCard({
      kind: 'publish',
      title: 'Publish greeting to the dashboard?',
      summary: tooLong
        ? `Draft is ${draft.length} chars (over 280). ${review.text}`
        : review.text,
      payload: { draft, length: draft.length, review: review.text },
    });
  }

  async execute(card: Card): Promise<string> {
    // Phase 0: "publishing" just records the outcome. Real workers act here.
    const draft = String(card.payload?.draft ?? '');
    return `Published greeting (${draft.length} chars).`;
  }
}
