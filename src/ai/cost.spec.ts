import { addUsage, computeCost, emptyUsage } from './cost.js';

describe('computeCost', () => {
  it('prices input and output tokens per million', () => {
    const usage = {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    expect(computeCost('claude-sonnet-5-5', usage)).toBe(12); // $2 + $10
  });

  it('includes cache reads and writes', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    };
    expect(computeCost('claude-opus-5-5', usage)).toBe(5.2); // $0.20 + $5
  });

  it('halves the cost for batch requests', () => {
    const usage = { ...emptyUsage(), inputTokens: 1_000_000 };
    expect(computeCost('claude-haiku-5-5', usage, { batch: true })).toBe(0.05);
  });

  it('adds usage field by field', () => {
    const a = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    };
    expect(addUsage(a, a)).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 6,
      cacheWriteTokens: 8,
    });
  });
});
