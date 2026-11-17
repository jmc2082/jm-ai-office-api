import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, like } from 'drizzle-orm';
import { DB } from '../../db/db.module.js';
import type { Db } from '../../db/db.js';
import { events } from '../../db/schema.js';
import {
  BaseWorker,
  type WorkerContext,
  type WorkerDefinition,
} from '../worker.base.js';

/** Feed lines look like "Jest shared today's joke: <joke>". */
export const JOKE_PREFIX = "shared today's joke: ";
const MAX_JOKE_CHARS = 400;
const RECENT_JOKES = 30;

/** Picked in code so the model doesn't keep reaching for the same scarecrow joke. */
export const JOKE_TOPICS = [
  'coffee',
  'meetings',
  'email',
  'spreadsheets',
  'the office printer',
  'Mondays',
  'computers',
  'programmers',
  'passwords',
  'the cloud',
  'calendars',
  'lunch',
  'pizza',
  'cheese',
  'vegetables',
  'baking',
  'dogs',
  'cats',
  'birds',
  'fish',
  'space',
  'the weather',
  'math',
  'chemistry',
  'history',
  'music',
  'sports',
  'books',
  'the ocean',
  'gardening',
  'trains',
  'time travel',
];

/**
 * Posts one clean, work-safe joke to Happening now every morning.
 * Read-only fun: nothing leaves the system, so no approval card.
 */
@Injectable()
export class JokeOfTheDayWorker extends BaseWorker {
  readonly definition: WorkerDefinition = {
    slug: 'joke-of-the-day',
    displayName: 'Jest',
    description:
      'Posts a clean, work-safe joke of the day to tell your co-workers.',
    department: 'culture',
    schedule: '0 0 13 * * *', // daily at 13:00 UTC (8 AM US Eastern in winter, 9 AM in summer)
    modelTaskKey: 'fun.joke',
    avatar: 'jest',
  };

  constructor(@Inject(DB) private readonly db: Db) {
    super();
  }

  async run(ctx: WorkerContext): Promise<void> {
    const topic =
      typeof ctx.input?.topic === 'string' && ctx.input.topic.trim()
        ? ctx.input.topic.trim().slice(0, 80)
        : JOKE_TOPICS[Math.floor(Math.random() * JOKE_TOPICS.length)]!;
    const recent = this.recentJokes(ctx.worker.id);
    ctx.log(`Topic: ${topic}. Avoiding ${recent.length} recent jokes.`);

    const avoid = recent.length
      ? `\n\nDo not repeat or closely rework any of these recent jokes:\n<recent>\n${recent.map((j) => `- ${j}`).join('\n')}\n</recent>`
      : '';
    const result = await ctx.ai('fun.joke', {
      system:
        'You write one joke of the day for someone to tell their co-workers. ' +
        'It must be clean and work-safe: no profanity, innuendo, politics, religion, ' +
        'or jokes about any group of people. Puns and wordplay are welcome. ' +
        'Keep it short enough to tell out loud (a setup line and a punchline). ' +
        'Reply with the joke only, plain text, no preamble or emoji.',
      messages: [{ role: 'user', content: `Today's topic: ${topic}.${avoid}` }],
    });

    // Deterministic checks first; the model only writes the joke.
    const joke = result.text.trim().replace(/\n{2,}/g, '\n');
    if (!joke) throw new Error('The model returned an empty joke.');
    if (joke.length > MAX_JOKE_CHARS)
      throw new Error(
        `Joke was ${joke.length} chars (limit ${MAX_JOKE_CHARS}); not posted.`,
      );

    ctx.log(`Joke: ${joke}`);
    ctx.announce(`${JOKE_PREFIX}${joke}`);
  }

  /** The last few jokes this worker posted, newest first. */
  recentJokes(workerId: number): string[] {
    return this.db
      .select({ message: events.message })
      .from(events)
      .where(
        and(
          eq(events.workerId, workerId),
          eq(events.type, 'info'),
          like(events.message, `%${JOKE_PREFIX}%`),
        ),
      )
      .orderBy(desc(events.id))
      .limit(RECENT_JOKES)
      .all()
      .map((r) =>
        r.message.slice(r.message.indexOf(JOKE_PREFIX) + JOKE_PREFIX.length),
      );
  }
}
