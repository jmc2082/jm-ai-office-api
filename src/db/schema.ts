import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Timestamps are stored as epoch milliseconds.
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);

export const WORKER_STATUSES = [
  'trial',
  'active',
  'paused',
  'retired',
] as const;
export const RUN_TRIGGERS = ['schedule', 'manual', 'handoff'] as const;
export const RUN_STATUSES = [
  'queued',
  'running',
  'ok',
  'failed',
  'needs_you',
] as const;
export const CARD_STATUSES = [
  'open',
  'approved',
  'rejected',
  'executed',
  'failed',
] as const;
export const EVENT_TYPES = [
  'run_queued',
  'run_started',
  'run_finished',
  'run_failed',
  'card_created',
  'card_resolved',
  'handoff',
  'info',
] as const;

export type WorkerStatus = (typeof WORKER_STATUSES)[number];
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type CardStatus = (typeof CARD_STATUSES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

export const workers = sqliteTable('workers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull().default(''),
  department: text('department').notNull().default('ops'),
  status: text('status', { enum: WORKER_STATUSES }).notNull().default('trial'),
  avatar: text('avatar'),
  schedule: text('schedule'), // cron expression; null = manual / hand-off only
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  modelTaskKey: text('model_task_key'),
  // false for rows with no code behind them (e.g. demo seed data)
  implemented: integer('implemented', { mode: 'boolean' })
    .notNull()
    .default(false),
  createdAt: createdAt(),
});

export const runs = sqliteTable(
  'runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workerId: integer('worker_id')
      .notNull()
      .references(() => workers.id),
    trigger: text('trigger', { enum: RUN_TRIGGERS }).notNull(),
    status: text('status', { enum: RUN_STATUSES }).notNull().default('queued'),
    input: text('input', { mode: 'json' }).$type<Record<string, unknown>>(),
    queuedAt: integer('queued_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    model: text('model'),
    log: text('log').notNull().default(''),
    error: text('error'),
  },
  (t) => [
    index('runs_worker_idx').on(t.workerId),
    index('runs_status_idx').on(t.status),
  ],
);

export const cards = sqliteTable(
  'cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id').references(() => runs.id),
    workerId: integer('worker_id')
      .notNull()
      .references(() => workers.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: CARD_STATUSES }).notNull().default('open'),
    createdAt: createdAt(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolutionNote: text('resolution_note'),
  },
  (t) => [index('cards_status_idx').on(t.status)],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    workerId: integer('worker_id').references(() => workers.id),
    runId: integer('run_id').references(() => runs.id),
    targetWorkerId: integer('target_worker_id').references(() => workers.id),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    message: text('message').notNull(),
  },
  (t) => [
    index('events_ts_idx').on(t.ts),
    index('events_type_ts_idx').on(t.type, t.ts),
  ],
);

// ── Inbox triage ────────────────────────────────────────────────────────────

export const MAIL_PROVIDERS = ['gmail', 'microsoft'] as const;
export const MAILBOX_STATUSES = ['active', 'needs_reauth'] as const;
export const MAIL_VERDICTS = [
  'needs_attention',
  'fyi',
  'newsletter',
  'likely_spam',
  'phishing',
] as const;
export const MAIL_DECIDERS = ['rules', 'model', 'fallback'] as const;

export type MailProviderKind = (typeof MAIL_PROVIDERS)[number];
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];
export type MailVerdict = (typeof MAIL_VERDICTS)[number];
export type MailDecider = (typeof MAIL_DECIDERS)[number];

/** A connected mailbox. The refresh token is AES-GCM encrypted (MAIL_TOKEN_KEY). */
export const mailboxes = sqliteTable(
  'mailboxes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', { enum: MAIL_PROVIDERS }).notNull(),
    address: text('address').notNull(),
    label: text('label'), // e.g. "personal", "work"
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    // Gmail historyId or Graph deltaLink; null = not synced yet
    cursor: text('cursor'),
    status: text('status', { enum: MAILBOX_STATUSES })
      .notNull()
      .default('active'),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('mailboxes_provider_address_idx').on(t.provider, t.address),
  ],
);

/** One triaged email. Only metadata and a short snippet are kept, never the body. */
export const mailMessages = sqliteTable(
  'mail_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mailboxId: integer('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id').notNull(),
    runId: integer('run_id').references(() => runs.id),
    cardId: integer('card_id').references(() => cards.id),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    verdict: text('verdict', { enum: MAIL_VERDICTS }).notNull(),
    topic: text('topic'),
    confidence: real('confidence'),
    reason: text('reason').notNull().default(''),
    decidedBy: text('decided_by', { enum: MAIL_DECIDERS }).notNull(),
    signals: text('signals', { mode: 'json' }).$type<Record<string, unknown>>(),
    link: text('link'),
    // Set once the message has been listed in a daily digest card
    digestedAt: integer('digested_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('mail_messages_mailbox_msg_idx').on(
      t.mailboxId,
      t.providerMessageId,
    ),
    index('mail_messages_verdict_idx').on(t.verdict),
    index('mail_messages_created_idx').on(t.createdAt),
  ],
);

export type Worker = typeof workers.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type MailMessageRow = typeof mailMessages.$inferSelect;
