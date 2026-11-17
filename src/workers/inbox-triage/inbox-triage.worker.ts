import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { DB } from '../../db/db.module.js';
import type { Db } from '../../db/db.js';
import {
  cards,
  type Card,
  type Mailbox,
  type MailDecider,
  type MailVerdict,
} from '../../db/schema.js';
import {
  buildClassifyPrompt,
  CLASSIFY_SYSTEM,
  parseClassification,
} from '../../mail/classify.js';
import { MailService } from '../../mail/mail.service.js';
import {
  ReauthRequiredError,
  type MailMessage,
} from '../../mail/mail.types.js';
import { collectSignals, decideByRules } from '../../mail/triage-rules.js';
import {
  BaseWorker,
  type WorkerContext,
  type WorkerDefinition,
} from '../worker.base.js';

export const CARD_KINDS = {
  attention: 'inbox_attention',
  phishing: 'inbox_phishing',
  digest: 'inbox_digest',
  reconnect: 'inbox_reconnect',
} as const;

const DIGEST_ORDER: MailVerdict[] = [
  'likely_spam',
  'needs_attention',
  'fyi',
  'newsletter',
  'phishing',
];
const DIGEST_LABEL: Record<MailVerdict, string> = {
  likely_spam: 'Likely spam',
  newsletter: 'Newsletters and promotions',
  fyi: 'FYI',
  needs_attention: 'Needs attention',
  phishing: 'Phishing',
};
const MAX_DIGEST_LINES = 60;

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * Reads new mail from each connected mailbox (read-only), decides what needs you and
 * what is spam, and surfaces it as cards. Code decides first; the model only sees unclear mail.
 */
@Injectable()
export class InboxTriageWorker extends BaseWorker {
  readonly definition: WorkerDefinition = {
    slug: 'inbox-triage',
    displayName: 'Sift',
    description:
      'Watches your Gmail and Microsoft inboxes and flags what needs you, what is spam, and what is phishing.',
    department: 'inbox',
    schedule: '0 */15 * * * *', // every 15 minutes
    modelTaskKey: 'inbox.classify',
    avatar: 'sift',
  };

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly mail: MailService,
  ) {
    super();
  }

  async run(ctx: WorkerContext): Promise<void> {
    if (!this.mail.enabled) {
      ctx.log('Inbox triage is disabled (MAIL_TOKEN_KEY not set).');
      return;
    }
    const boxes = this.mail.active();
    if (!boxes.length) {
      ctx.log(
        'No active mailboxes. Connect one via POST /api/mail/connect/:provider.',
      );
      return;
    }

    const tally = new Map<MailVerdict, number>();
    const failures: string[] = [];
    for (const box of boxes) {
      try {
        await this.triageMailbox(ctx, box, tally);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${box.address}: ${message}`);
        ctx.log(`${box.address} failed: ${message}`);
        if (err instanceof ReauthRequiredError) {
          ctx.createCard({
            kind: CARD_KINDS.reconnect,
            title: `Reconnect ${box.address}`,
            summary: `Sift can no longer read ${box.address} (${box.provider}). The sign-in expired or was revoked. Reconnect it from the dashboard; triage resumes where it left off.`,
            payload: {
              mailboxId: box.id,
              provider: box.provider,
              address: box.address,
            },
          });
        } else {
          this.mail.markError(box.id, message);
        }
      }
    }

    const total = [...tally.values()].reduce((a, b) => a + b, 0);
    if (total) {
      const n = (v: MailVerdict) => tally.get(v) ?? 0;
      const parts = [
        `${n('needs_attention')} need you`,
        n('phishing') && `${n('phishing')} phishing`,
        `${n('likely_spam')} likely spam`,
        `${n('newsletter') + n('fyi')} newsletters/FYI`,
      ].filter(Boolean);
      ctx.announce(
        `triaged ${total} new email${total === 1 ? '' : 's'}: ${parts.join(', ')}`,
      );
    }

    this.maybeDigest(ctx);

    if (failures.length === boxes.length)
      throw new Error(`Every mailbox failed. ${failures.join(' | ')}`);
  }

  private async triageMailbox(
    ctx: WorkerContext,
    box: Mailbox,
    tally: Map<MailVerdict, number>,
  ): Promise<void> {
    const cfg = this.mail.config;
    const provider = this.mail.provider(box.provider);
    const token = await this.mail.accessToken(box);
    const { ids, cursor } = await provider.listNew(token, box.cursor, {
      sinceMs: Date.now() - cfg.lookbackHours * 3_600_000,
      max: cfg.maxPerRun,
    });

    const known = this.mail.knownIds(box.id, ids);
    const fresh = ids.filter((id) => !known.has(id));
    const batch = fresh.slice(-cfg.maxPerRun); // newest N
    if (fresh.length > batch.length)
      ctx.log(
        `${box.address}: ${fresh.length} new, triaging the newest ${batch.length} (MAIL_MAX_PER_RUN); older ones are skipped.`,
      );
    else ctx.log(`${box.address}: ${batch.length} new message(s).`);

    const label = box.label ? `${box.label} (${box.provider})` : box.provider;
    for (const id of batch) {
      const msg = await provider.get(token, id, box.address);
      if (!msg) continue;
      const verdict = await this.triageOne(ctx, box, msg, label);
      tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
    }

    // Only advance once everything above succeeded; a failed run retries from the old cursor.
    this.mail.markSynced(box.id, cursor);
  }

  private async triageOne(
    ctx: WorkerContext,
    box: Mailbox,
    msg: MailMessage,
    mailboxLabel: string,
  ): Promise<MailVerdict> {
    const signals = collectSignals(msg, this.mail.config.vipSenders);
    let decidedBy: MailDecider = 'rules';
    let topic: string | null = null;
    let decision = decideByRules(signals);

    if (!decision) {
      const res = await ctx.ai('inbox.classify', {
        system: CLASSIFY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: buildClassifyPrompt(msg, mailboxLabel, signals),
          },
        ],
      });
      const parsed = parseClassification(res.text);
      if (parsed) {
        decidedBy = 'model';
        topic = parsed.topic;
        decision = parsed;
      } else {
        // Never drop mail: an unreadable answer lands in the digest for you to eyeball.
        decidedBy = 'fallback';
        decision = {
          verdict: 'fyi',
          reason: 'Could not classify automatically; please check.',
          confidence: 0,
        };
      }
    }

    const sender = msg.from.name ?? msg.from.address;
    const snippet = clip(msg.snippet.replace(/\s+/g, ' ').trim(), 200);
    let card: Card | null = null;
    if (
      decision.verdict === 'needs_attention' ||
      decision.verdict === 'phishing'
    ) {
      const phishing = decision.verdict === 'phishing';
      card = ctx.createCard({
        kind: phishing ? CARD_KINDS.phishing : CARD_KINDS.attention,
        title: clip(
          phishing
            ? `Possible phishing: ${msg.subject || '(no subject)'}`
            : `${sender}: ${msg.subject || '(no subject)'}`,
          140,
        ),
        summary: [
          phishing
            ? `Don't click links or reply. ${decision.reason}`
            : decision.reason,
          `${mailboxLabel} · from ${msg.from.address}`,
          snippet && `“${snippet}”`,
        ]
          .filter(Boolean)
          .join('\n'),
        payload: {
          mailbox: box.address,
          provider: box.provider,
          from: msg.from,
          subject: msg.subject,
          snippet,
          receivedAt: msg.receivedAt.toISOString(),
          verdict: decision.verdict,
          topic,
          reason: decision.reason,
          confidence: decision.confidence,
          decidedBy,
          link: msg.webLink,
        },
      });
    }

    this.mail.record({
      mailboxId: box.id,
      providerMessageId: msg.providerId,
      runId: ctx.runId,
      cardId: card?.id ?? null,
      fromAddress: msg.from.address,
      fromName: msg.from.name,
      subject: clip(msg.subject, 300),
      snippet,
      receivedAt: msg.receivedAt,
      verdict: decision.verdict,
      topic,
      confidence: decision.confidence,
      reason: decision.reason,
      decidedBy,
      signals: { ...signals },
      link: msg.webLink,
    });
    return decision.verdict;
  }

  /** Once a day, after MAIL_DIGEST_HOUR_UTC, list everything that didn't get its own card. */
  private maybeDigest(ctx: WorkerContext): void {
    const now = new Date();
    if (now.getUTCHours() < this.mail.config.digestHourUtc) return;
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const already = this.db
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          eq(cards.workerId, ctx.worker.id),
          eq(cards.kind, CARD_KINDS.digest),
          gte(cards.createdAt, midnight),
        ),
      )
      .get();
    if (already) return;

    const items = this.mail.undigested();
    if (!items.length) return;

    const groups = new Map<MailVerdict, typeof items>();
    for (const m of items)
      groups.set(m.verdict, [...(groups.get(m.verdict) ?? []), m]);

    const lines: string[] = [];
    for (const v of DIGEST_ORDER) {
      const group = groups.get(v);
      if (!group?.length) continue;
      lines.push(`${DIGEST_LABEL[v]} (${group.length})`);
      for (const m of group.slice(0, MAX_DIGEST_LINES))
        lines.push(
          `• ${clip(m.fromName ?? m.fromAddress, 40)}: ${clip(m.subject || '(no subject)', 80)}${v === 'likely_spam' ? ` (${m.reason})` : ''}`,
        );
      if (group.length > MAX_DIGEST_LINES)
        lines.push(`• …and ${group.length - MAX_DIGEST_LINES} more`);
      lines.push('');
    }

    const spam = groups.get('likely_spam')?.length ?? 0;
    ctx.createCard({
      kind: CARD_KINDS.digest,
      title: `Inbox digest: ${items.length} email${items.length === 1 ? '' : 's'}${spam ? `, ${spam} likely spam` : ''}`,
      summary: lines.join('\n').trim(),
      payload: {
        count: items.length,
        items: items.map((m) => ({
          id: m.id,
          mailbox: m.mailboxAddress,
          from: { name: m.fromName, address: m.fromAddress },
          subject: m.subject,
          verdict: m.verdict,
          reason: m.reason,
          receivedAt: m.receivedAt,
          link: m.link,
        })),
      },
    });
    this.mail.markDigested(items.map((m) => m.id));
  }

  /** Read-only in v1: approving just acknowledges. Moving spam comes later, behind its own scope. */
  async execute(card: Card): Promise<string> {
    switch (card.kind) {
      case CARD_KINDS.digest:
        return 'Digest reviewed.';
      case CARD_KINDS.reconnect:
        return 'Noted. Reconnect the mailbox to resume triage.';
      default:
        return 'Marked as handled.';
    }
  }
}
