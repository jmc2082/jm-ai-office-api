import { Injectable } from '@nestjs/common';
import {
  BaseWorker,
  type WorkerContext,
  type WorkerDefinition,
} from '../worker.base.js';

/**
 * Phase 0 smoke worker: calls the model, hands the draft to a reviewer.
 * Exercises the whole lifecycle without touching any external system.
 */
@Injectable()
export class HelloWorldWorker extends BaseWorker {
  readonly definition: WorkerDefinition = {
    slug: 'hello-world',
    displayName: 'Echo',
    description:
      'Writes a short daily greeting and passes it to Proof for review.',
    department: 'ops',
    schedule: '0 */30 * * * *', // every 30 minutes
    modelTaskKey: 'hello.echo',
    avatar: 'echo',
  };

  async run(ctx: WorkerContext): Promise<void> {
    const topic =
      typeof ctx.input?.topic === 'string'
        ? ctx.input.topic
        : 'the start of a productive work session';
    ctx.log(`Drafting a greeting about: ${topic}`);

    const result = await ctx.ai('hello.echo', {
      system:
        'You write one-sentence, upbeat status greetings for an engineering dashboard. Plain text only.',
      messages: [
        {
          role: 'user',
          content: `Write a one-sentence greeting about ${topic}.`,
        },
      ],
    });
    ctx.log(`Draft: ${result.text}`);

    ctx.handoff('hello-reviewer', 'passed a greeting draft to Proof', {
      draft: result.text,
    });
  }
}
