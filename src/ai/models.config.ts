// Single source of truth for which model each task uses (roadmap §5).
// Bump `promptVersion` whenever a task's prompt changes so output changes can be traced.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelTask {
  model: ModelId;
  maxTokens: number;
  effort: Effort;
  promptVersion: string;
  mode: 'realtime' | 'batch' | 'claude-code' | 'manual';
}

// USD per million tokens. Verify against current pricing before relying on totals.
export const MODEL_PRICING = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
} as const;

export type ModelId = keyof typeof MODEL_PRICING;

export const MODEL_TASKS = {
  'hello.echo': {
    model: 'claude-haiku-5-5',
    maxTokens: 1024,
    effort: 'low',
    promptVersion: 'v1',
    mode: 'realtime',
  },
  'hello.review': {
    model: 'claude-haiku-5-5',
    maxTokens: 1024,
    effort: 'low',
    promptVersion: 'v1',
    mode: 'realtime',
  },
  'inbox.classify': {
    model: 'claude-haiku-5-5',
    maxTokens: 256,
    effort: 'low',
    promptVersion: 'v1',
    mode: 'realtime',
  },
  'inbox.draft_reply': {
    model: 'claude-sonnet-5-5',
    maxTokens: 4000,
    effort: 'medium',
    promptVersion: 'v1',
    mode: 'realtime',
  },
  'tests.generate': {
    model: 'claude-sonnet-5-5',
    maxTokens: 16000,
    effort: 'high',
    promptVersion: 'v1',
    mode: 'claude-code',
  },
  'tests.repair': {
    model: 'claude-sonnet-5-5',
    maxTokens: 16000,
    effort: 'high',
    promptVersion: 'v1',
    mode: 'claude-code',
  },
  'pr.review': {
    model: 'claude-sonnet-5-5',
    maxTokens: 8000,
    effort: 'medium',
    promptVersion: 'v1',
    mode: 'realtime',
  },
  'analytics.weekly_report': {
    model: 'claude-sonnet-5-5',
    maxTokens: 8000,
    effort: 'medium',
    promptVersion: 'v1',
    mode: 'batch',
  },
  'email.campaign_copy': {
    model: 'claude-sonnet-5-5',
    maxTokens: 8000,
    effort: 'medium',
    promptVersion: 'v1',
    mode: 'realtime',
  },
  'social.draft': {
    model: 'claude-haiku-5-5',
    maxTokens: 2000,
    effort: 'low',
    promptVersion: 'v1',
    mode: 'batch',
  },
  'debug.hard': {
    model: 'claude-opus-5-5',
    maxTokens: 32000,
    effort: 'high',
    promptVersion: 'v1',
    mode: 'manual',
  },
} as const satisfies Record<string, ModelTask>;

export type TaskKey = keyof typeof MODEL_TASKS;

export function isTaskKey(key: string): key is TaskKey {
  return key in MODEL_TASKS;
}
