/**
 * Fills the database with demo workers, runs, cards and events so the
 * dashboard has something to show. Demo workers have `implemented = false`,
 * so they never run. Re-running replaces previous demo data.
 *
 *   npm run db:seed:demo
 */
import { eq, inArray } from 'drizzle-orm';
import { openDb } from './db.js';
import { cards, events, runs, workers } from './schema.js';

const DEMO = [
  {
    slug: 'demo-smoke',
    displayName: 'Pulse',
    department: 'release',
    description: 'Runs a smoke test after each deploy.',
  },
  {
    slug: 'demo-tests',
    displayName: 'Probe',
    department: 'quality',
    description: 'Writes and repairs Playwright specs.',
  },
  {
    slug: 'demo-inbox',
    displayName: 'Sorter',
    department: 'inbox',
    description: 'Labels inbound mail.',
  },
  {
    slug: 'demo-drafts',
    displayName: 'Quill',
    department: 'inbox',
    description: 'Drafts support replies.',
  },
  {
    slug: 'demo-ga4',
    displayName: 'Lens',
    department: 'analytics',
    description: 'Weekly GA4 report and anomaly flags.',
  },
  {
    slug: 'demo-gtm',
    displayName: 'Vault',
    department: 'analytics',
    description: 'Nightly GTM container backup.',
  },
  {
    slug: 'demo-campaign',
    displayName: 'Herald',
    department: 'marketing',
    description: 'Drafts email campaign copy.',
  },
  {
    slug: 'demo-social',
    displayName: 'Buzz',
    department: 'social',
    description: 'Drafts a weekly batch of social posts.',
  },
  {
    slug: 'demo-pr',
    displayName: 'Critic',
    department: 'release',
    description: 'Reviews pull requests.',
  },
] as const;

const { db, sqlite } = openDb(process.env.DATABASE_PATH ?? './data/office.db');

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(xs: readonly T[]) => xs[rand(0, xs.length - 1)];

sqlite.transaction(() => {
  // Remove previous demo data.
  const old = db
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.implemented, false))
    .all()
    .map((w) => w.id);
  if (old.length) {
    db.delete(events).where(inArray(events.workerId, old)).run();
    db.delete(events).where(inArray(events.targetWorkerId, old)).run();
    db.delete(cards).where(inArray(cards.workerId, old)).run();
    db.delete(runs).where(inArray(runs.workerId, old)).run();
    db.delete(workers).where(inArray(workers.id, old)).run();
  }

  const ids = new Map<string, { id: number; name: string }>();
  for (const d of DEMO) {
    const row = db
      .insert(workers)
      .values({
        ...d,
        avatar: d.displayName.toLowerCase(),
        status: pick(['trial', 'active', 'active']),
        implemented: false,
      })
      .returning()
      .get();
    ids.set(d.slug, { id: row.id, name: row.displayName });
  }

  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const span = Math.max(now - midnight.getTime(), 60 * 60 * 1000);

  // ~6 runs per worker spread across today.
  for (const d of DEMO) {
    const w = ids.get(d.slug)!;
    const failLast = d.slug === 'demo-gtm';
    for (let i = 0; i < 6; i++) {
      const start = now - span + Math.floor((span / 6) * i) + rand(0, 300_000);
      const end = start + rand(5_000, 120_000);
      const isLast = i === 5;
      const status = isLast && failLast ? 'failed' : 'ok';
      const inputTokens = rand(400, 6000);
      const outputTokens = rand(100, 1500);
      const run = db
        .insert(runs)
        .values({
          workerId: w.id,
          trigger: 'schedule',
          status,
          queuedAt: new Date(start),
          startedAt: new Date(start),
          finishedAt: new Date(end),
          inputTokens,
          outputTokens,
          costUsd:
            Math.round(
              ((inputTokens * 2 + outputTokens * 10) / 1_000_000) * 1e6,
            ) / 1e6,
          model: 'claude-sonnet-5-5',
          error:
            status === 'failed' ? 'GTM API returned 403 (token expired)' : null,
          log: '[demo] seeded run',
        })
        .returning()
        .get();
      db.insert(events)
        .values({
          ts: new Date(start),
          workerId: w.id,
          runId: run.id,
          type: 'run_started',
          message: `${w.name} started a run`,
        })
        .run();
      db.insert(events)
        .values({
          ts: new Date(end),
          workerId: w.id,
          runId: run.id,
          type: status === 'failed' ? 'run_failed' : 'run_finished',
          message:
            status === 'failed'
              ? `${w.name} failed: GTM API returned 403 (token expired)`
              : `${w.name} finished a run clean`,
        })
        .run();
    }
  }

  // Hand-offs between demo workers.
  const handoffs: Array<[string, string, string]> = [
    ['demo-inbox', 'demo-drafts', 'passed 3 support emails to Quill'],
    ['demo-tests', 'demo-pr', 'passed a repaired spec to Critic'],
    ['demo-campaign', 'demo-social', 'passed launch copy to Buzz'],
    ['demo-ga4', 'demo-campaign', 'passed a traffic dip note to Herald'],
  ];
  for (let i = 0; i < 12; i++) {
    const [from, to, msg] = pick(handoffs);
    const f = ids.get(from)!;
    const t = ids.get(to)!;
    db.insert(events)
      .values({
        ts: new Date(now - rand(0, span)),
        workerId: f.id,
        targetWorkerId: t.id,
        type: 'handoff',
        message: `${f.name} ${msg}`,
      })
      .run();
  }

  // Open cards waiting for approval.
  const openCards: Array<[string, string, string, string]> = [
    [
      'demo-drafts',
      'email_reply',
      'Reply to "Invoice question"',
      'Draft reply ready; customer asks about a duplicate charge.',
    ],
    [
      'demo-drafts',
      'email_reply',
      'Reply to "Login broken on Safari"',
      'Draft acknowledges the bug and links the status page.',
    ],
    [
      'demo-campaign',
      'send_campaign',
      'Send November newsletter',
      '1,240 recipients. Subject: "What shipped this month".',
    ],
    [
      'demo-gtm',
      'gtm_publish',
      'Publish GTM container v42',
      'Adds a conversion tag for the pricing page.',
    ],
    [
      'demo-smoke',
      'alert',
      'Smoke test failed on checkout',
      'Step "pay with card" timed out after 30s on production.',
    ],
  ];
  for (const [slug, kind, title, summary] of openCards) {
    const w = ids.get(slug)!;
    const ts = new Date(now - rand(60_000, 3 * 3_600_000));
    db.insert(cards)
      .values({
        workerId: w.id,
        kind,
        title,
        summary,
        payload: { demo: true },
        createdAt: ts,
      })
      .run();
    db.insert(events)
      .values({
        ts,
        workerId: w.id,
        type: 'card_created',
        message: `${w.name} put "${title}" in front of you`,
      })
      .run();
  }
})();

sqlite.close();
console.log(
  `Seeded ${DEMO.length} demo workers with runs, hand-offs and open cards.`,
);
