import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { computeCost, type TokenUsage } from './cost.js';
import { MODEL_TASKS, type ModelId, type TaskKey } from './models.config.js';

export interface CompleteParams {
  system?: string;
  messages: Anthropic.MessageParam[];
}

export interface CompleteResult {
  text: string;
  model: ModelId;
  usage: TokenUsage;
  costUsd: number;
  stopReason: string | null;
  promptVersion: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly mode: 'live' | 'mock';
  private client?: Anthropic;

  constructor(config: ConfigService) {
    this.mode = config.get<'live' | 'mock'>('ai.mode') ?? 'mock';
    this.logger.log(`AI mode: ${this.mode}`);
  }

  /** Run one model call for a routed task. Callers never pick a model directly. */
  async complete(
    taskKey: TaskKey,
    params: CompleteParams,
  ): Promise<CompleteResult> {
    const task = MODEL_TASKS[taskKey];
    if (this.mode === 'mock') return this.mockComplete(taskKey, params);

    // Credentials resolve from ANTHROPIC_API_KEY (SSM in production).
    this.client ??= new Anthropic();
    const response = await this.client.messages.create({
      model: task.model,
      max_tokens: task.maxTokens,
      output_config: { effort: task.effort },
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages,
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `Model refused (${response.stop_details?.category ?? 'unknown category'})`,
      );
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    return {
      text,
      model: task.model,
      usage,
      costUsd: computeCost(task.model, usage, { batch: task.mode === 'batch' }),
      stopReason: response.stop_reason,
      promptVersion: task.promptVersion,
    };
  }

  private mockComplete(
    taskKey: TaskKey,
    params: CompleteParams,
  ): CompleteResult {
    const task = MODEL_TASKS[taskKey];
    const last = params.messages.at(-1);
    const prompt =
      typeof last?.content === 'string' ? last.content : '[structured input]';
    const usage: TokenUsage = {
      inputTokens: 40 + Math.ceil(prompt.length / 4),
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    return {
      text: `[mock ${task.model}] Responding to: ${prompt.slice(0, 120)}`,
      model: task.model,
      usage,
      costUsd: computeCost(task.model, usage),
      stopReason: 'end_turn',
      promptVersion: task.promptVersion,
    };
  }
}
