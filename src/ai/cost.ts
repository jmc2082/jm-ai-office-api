import { MODEL_PRICING, type ModelId } from './models.config.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Cost in USD. `batch` applies the Batch API's 50% discount. */
export function computeCost(
  model: ModelId,
  usage: TokenUsage,
  opts: { batch?: boolean } = {},
): number {
  const p = MODEL_PRICING[model];
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  const total = opts.batch ? usd * 0.5 : usd;
  return Math.round(total * 1_000_000) / 1_000_000; // micro-dollar precision
}
