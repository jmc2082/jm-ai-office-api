import type { MailVerdict } from '../db/schema.js';
import type { MailMessage } from './mail.types.js';

// Deterministic checks run before any model call (roadmap principle 3).

export interface AuthResult {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

export interface Signals {
  auth: AuthResult;
  authFailed: boolean;
  vip: boolean;
  bulk: boolean;
  replyToMismatch: boolean;
  promotions: boolean;
  social: boolean;
  focusedOther: boolean;
}

export interface Decision {
  verdict: MailVerdict;
  reason: string;
  confidence: number;
}

export function parseAuthResults(header: string | null): AuthResult {
  const pick = (key: string) => {
    if (!header) return null;
    const m = new RegExp(`\\b${key}=([a-z]+)`, 'i').exec(header);
    return m ? m[1]!.toLowerCase() : null;
  };
  return { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
}

const domainOf = (address: string) =>
  address.slice(address.lastIndexOf('@') + 1).toLowerCase();

/** VIP entries are full addresses (a@b.com) or domains (b.com / @b.com, subdomains match). */
export function isVip(address: string, vipSenders: string[]): boolean {
  const addr = address.toLowerCase();
  const domain = domainOf(addr);
  return vipSenders.some((entry) => {
    const e = entry.toLowerCase();
    if (e.includes('@') && !e.startsWith('@')) return e === addr;
    const d = e.replace(/^@/, '');
    return domain === d || domain.endsWith(`.${d}`);
  });
}

export function collectSignals(
  msg: MailMessage,
  vipSenders: string[],
): Signals {
  const auth = parseAuthResults(msg.headers.authenticationResults);
  const authFailed =
    auth.dmarc === 'fail' ||
    (auth.spf === 'fail' && (auth.dkim === 'fail' || auth.dkim === 'none'));
  const fromDomain = domainOf(msg.from.address);
  return {
    auth,
    authFailed,
    vip: isVip(msg.from.address, vipSenders),
    bulk: msg.headers.listUnsubscribe || msg.headers.precedenceBulk,
    replyToMismatch: msg.replyTo.some((r) => domainOf(r) !== fromDomain),
    ...msg.providerHints,
  };
}

/** A verdict when code alone can decide; null means ask the model. */
export function decideByRules(s: Signals): Decision | null {
  const failed = `failed sender authentication (spf=${s.auth.spf ?? '?'}, dkim=${s.auth.dkim ?? '?'}, dmarc=${s.auth.dmarc ?? '?'})`;
  if (s.vip && s.authFailed)
    return {
      verdict: 'phishing',
      reason: `Claims to be a VIP sender but ${failed}`,
      confidence: 0.95,
    };
  if (s.vip)
    return {
      verdict: 'needs_attention',
      reason: 'Sender is on your VIP list',
      confidence: 0.9,
    };
  if (s.authFailed)
    return {
      verdict: 'likely_spam',
      reason: `Sender ${failed}`,
      confidence: 0.85,
    };
  if (s.bulk && (s.promotions || s.social || s.focusedOther))
    return {
      verdict: 'newsletter',
      reason:
        'Bulk mail your provider already files as promotional or non-Focused',
      confidence: 0.8,
    };
  return null;
}
