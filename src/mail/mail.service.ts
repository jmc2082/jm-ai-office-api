import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import type { MailConfig } from '../config/configuration.js';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/db.js';
import {
  mailboxes,
  mailMessages,
  type Mailbox,
  type MailMessageRow,
  type MailProviderKind,
  type MailVerdict,
} from '../db/schema.js';
import { ReauthRequiredError, type MailProviderClient } from './mail.types.js';
import { GmailProvider } from './providers/gmail.provider.js';
import { MicrosoftProvider } from './providers/microsoft.provider.js';
import { TokenCipher } from './token-cipher.js';

/** Mailbox view safe to return over the API (no token). */
export type PublicMailbox = Omit<Mailbox, 'refreshTokenEnc' | 'cursor'>;

const toPublic = ({
  refreshTokenEnc: _t,
  cursor: _c,
  ...rest
}: Mailbox): PublicMailbox => rest;

/** Connected mailboxes, their tokens, and the triaged-message store. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  readonly config: MailConfig;
  private readonly cipher?: TokenCipher;
  private readonly providers: Record<MailProviderKind, MailProviderClient>;
  private readonly accessTokens = new Map<
    number,
    { token: string; expiresAt: number }
  >();

  constructor(
    @Inject(DB) private readonly db: Db,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<MailConfig>('mail');
    if (this.config.tokenKey)
      this.cipher = new TokenCipher(this.config.tokenKey);
    else
      this.logger.warn('MAIL_TOKEN_KEY is not set; inbox triage is disabled.');
    this.providers = {
      gmail: new GmailProvider(this.config),
      microsoft: new MicrosoftProvider(this.config),
    };
  }

  get enabled(): boolean {
    return !!this.cipher;
  }

  provider(kind: MailProviderKind): MailProviderClient {
    return this.providers[kind];
  }

  private requireCipher(): TokenCipher {
    if (!this.cipher)
      throw new Error('Inbox triage is disabled: set MAIL_TOKEN_KEY.');
    return this.cipher;
  }

  // ── Mailboxes ─────────────────────────────────────────────────────────────

  list(): PublicMailbox[] {
    return this.db
      .select()
      .from(mailboxes)
      .orderBy(mailboxes.id)
      .all()
      .map(toPublic);
  }

  active(): Mailbox[] {
    return this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.status, 'active'))
      .all();
  }

  /** Insert or reconnect. Reconnecting keeps the cursor so nothing is re-triaged. */
  upsertConnected(
    provider: MailProviderKind,
    address: string,
    refreshToken: string,
    label: string | null,
  ): PublicMailbox {
    const enc = this.requireCipher().encrypt(refreshToken);
    const row = this.db
      .insert(mailboxes)
      .values({ provider, address, label, refreshTokenEnc: enc })
      .onConflictDoUpdate({
        target: [mailboxes.provider, mailboxes.address],
        set: {
          refreshTokenEnc: enc,
          status: 'active',
          lastError: null,
          ...(label ? { label } : {}),
        },
      })
      .returning()
      .get();
    this.accessTokens.delete(row.id);
    return toPublic(row);
  }

  remove(id: number): void {
    const res = this.db.delete(mailboxes).where(eq(mailboxes.id, id)).run();
    if (!res.changes) throw new NotFoundException(`Mailbox ${id} not found`);
    this.accessTokens.delete(id);
  }

  /** A valid access token, refreshing (and storing a rotated refresh token) as needed. */
  async accessToken(box: Mailbox): Promise<string> {
    const cached = this.accessTokens.get(box.id);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

    const cipher = this.requireCipher();
    try {
      const tokens = await this.provider(box.provider).refresh(
        cipher.decrypt(box.refreshTokenEnc),
      );
      if (tokens.refreshToken)
        this.db
          .update(mailboxes)
          .set({ refreshTokenEnc: cipher.encrypt(tokens.refreshToken) })
          .where(eq(mailboxes.id, box.id))
          .run();
      this.accessTokens.set(box.id, {
        token: tokens.accessToken,
        expiresAt: tokens.expiresAt,
      });
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof ReauthRequiredError)
        this.db
          .update(mailboxes)
          .set({ status: 'needs_reauth', lastError: err.message })
          .where(eq(mailboxes.id, box.id))
          .run();
      throw err;
    }
  }

  markSynced(id: number, cursor: string): void {
    this.db
      .update(mailboxes)
      .set({ cursor, lastSyncedAt: new Date(), lastError: null })
      .where(eq(mailboxes.id, id))
      .run();
  }

  markError(id: number, error: string): void {
    this.db
      .update(mailboxes)
      .set({ lastError: error.slice(0, 500) })
      .where(eq(mailboxes.id, id))
      .run();
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /** Which of these provider IDs were already triaged for the mailbox. */
  knownIds(mailboxId: number, ids: string[]): Set<string> {
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const r of this.db
        .select({ id: mailMessages.providerMessageId })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxId, mailboxId),
            inArray(mailMessages.providerMessageId, chunk),
          ),
        )
        .all())
        known.add(r.id);
    }
    return known;
  }

  /** Undefined when the message was already recorded. */
  record(row: typeof mailMessages.$inferInsert): MailMessageRow | undefined {
    return this.db
      .insert(mailMessages)
      .values(row)
      .onConflictDoNothing()
      .returning()
      .get();
  }

  /** Triaged messages that didn't get their own card and haven't been in a digest yet. */
  undigested(): Array<
    MailMessageRow & { mailboxAddress: string; mailboxLabel: string | null }
  > {
    return this.db
      .select({
        m: mailMessages,
        address: mailboxes.address,
        label: mailboxes.label,
      })
      .from(mailMessages)
      .innerJoin(mailboxes, eq(mailboxes.id, mailMessages.mailboxId))
      .where(and(isNull(mailMessages.digestedAt), isNull(mailMessages.cardId)))
      .orderBy(mailMessages.receivedAt)
      .all()
      .map(({ m, address, label }) => ({
        ...m,
        mailboxAddress: address,
        mailboxLabel: label,
      }));
  }

  markDigested(ids: number[]): void {
    const now = new Date();
    for (let i = 0; i < ids.length; i += 500)
      this.db
        .update(mailMessages)
        .set({ digestedAt: now })
        .where(inArray(mailMessages.id, ids.slice(i, i + 500)))
        .run();
  }

  messages(
    opts: { verdict?: MailVerdict; limit?: number; before?: number } = {},
  ) {
    const where: SQL[] = [];
    if (opts.verdict) where.push(eq(mailMessages.verdict, opts.verdict));
    if (opts.before) where.push(lt(mailMessages.id, opts.before));
    return this.db
      .select({
        m: mailMessages,
        address: mailboxes.address,
        label: mailboxes.label,
      })
      .from(mailMessages)
      .innerJoin(mailboxes, eq(mailboxes.id, mailMessages.mailboxId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(mailMessages.id))
      .limit(Math.min(opts.limit ?? 50, 200))
      .all()
      .map(({ m, address, label }) => ({ ...m, mailbox: { address, label } }));
  }
}
