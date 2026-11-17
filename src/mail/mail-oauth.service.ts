import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { MailProviderKind } from '../db/schema.js';
import { MailService, type PublicMailbox } from './mail.service.js';

const STATE_TTL_MS = 10 * 60_000;

interface Pending {
  provider: MailProviderKind;
  verifier: string;
  label: string | null;
  expiresAt: number;
}

/**
 * Authorization-code + PKCE sign-in for a mailbox. State lives in memory:
 * one box, one process, and an abandoned sign-in simply expires.
 */
@Injectable()
export class MailOAuthService {
  private readonly logger = new Logger(MailOAuthService.name);
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly mail: MailService) {}

  start(provider: MailProviderKind, label: string | null): { url: string } {
    if (!this.mail.enabled)
      throw new BadRequestException(
        'Inbox triage is disabled: set MAIL_TOKEN_KEY.',
      );
    const client = this.mail.provider(provider);
    if (!client.configured())
      throw new BadRequestException(
        `${provider} OAuth client ID/secret are not configured.`,
      );

    this.sweep();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(state, {
      provider,
      verifier,
      label,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return { url: client.authUrl(state, challenge) };
  }

  async finish(
    provider: MailProviderKind,
    state: string,
    code: string,
  ): Promise<PublicMailbox> {
    const p = this.pending.get(state);
    this.pending.delete(state); // single use
    if (!p || p.expiresAt < Date.now() || p.provider !== provider)
      throw new BadRequestException(
        'Sign-in link expired or invalid. Start again from the dashboard.',
      );

    const client = this.mail.provider(provider);
    const tokens = await client.exchangeCode(code, p.verifier);
    if (!tokens.refreshToken)
      throw new BadRequestException(
        'The provider did not return a refresh token. Remove the app from your account permissions and connect again.',
      );
    const address = await client.whoAmI(tokens.accessToken);
    const box = this.mail.upsertConnected(
      provider,
      address,
      tokens.refreshToken,
      p.label,
    );
    this.logger.log(`Connected ${provider} mailbox #${box.id}`);
    return box;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.pending)
      if (v.expiresAt < now) this.pending.delete(k);
  }
}
