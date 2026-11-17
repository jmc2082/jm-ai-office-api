import type { MailConfig } from '../../config/configuration.js';
import {
  HttpError,
  MAX_BODY_CHARS,
  type ListResult,
  type MailMessage,
  type MailProviderClient,
  type OAuthTokens,
} from '../mail.types.js';
import {
  decodeEntities,
  getJson,
  htmlToText,
  parseAddress,
  postToken,
} from './http.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface HistoryPage {
  history?: Array<{
    messagesAdded?: Array<{ message: { id: string; labelIds?: string[] } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

/** Gmail via REST, read-only scope. Cursor = historyId. */
export class GmailProvider implements MailProviderClient {
  readonly kind = 'gmail' as const;

  constructor(private readonly cfg: MailConfig) {}

  private get redirectUri() {
    return `${this.cfg.oauthRedirectBase}/gmail`;
  }

  configured(): boolean {
    return !!(this.cfg.google.clientId && this.cfg.google.clientSecret);
  }

  authUrl(state: string, codeChallenge: string): string {
    const q = new URLSearchParams({
      client_id: this.cfg.google.clientId!,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent', // always return a refresh token
      include_granted_scopes: 'false',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    return postToken(TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.redirectUri,
      client_id: this.cfg.google.clientId!,
      client_secret: this.cfg.google.clientSecret!,
    });
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return postToken(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.cfg.google.clientId!,
      client_secret: this.cfg.google.clientSecret!,
    });
  }

  async whoAmI(accessToken: string): Promise<string> {
    const p = await getJson<{ emailAddress: string }>(
      `${API}/profile`,
      accessToken,
    );
    return p.emailAddress.toLowerCase();
  }

  async listNew(
    accessToken: string,
    cursor: string | null,
    opts: { sinceMs: number; max: number },
  ): Promise<ListResult> {
    if (!cursor) return this.initialList(accessToken, opts);

    const ids: string[] = [];
    let latest = cursor;
    let pageToken: string | undefined;
    try {
      do {
        const q = new URLSearchParams({
          startHistoryId: cursor,
          historyTypes: 'messageAdded',
          labelId: 'INBOX',
          maxResults: '500',
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await getJson<HistoryPage>(
          `${API}/history?${q}`,
          accessToken,
        );
        for (const h of page.history ?? [])
          for (const added of h.messagesAdded ?? [])
            if (added.message.labelIds?.includes('INBOX'))
              ids.push(added.message.id);
        if (page.historyId) latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err) {
      // A historyId older than about a week is gone; start over from the lookback window.
      if (err instanceof HttpError && err.status === 404)
        return this.initialList(accessToken, opts);
      throw err;
    }
    return { ids: [...new Set(ids)], cursor: latest };
  }

  private async initialList(
    accessToken: string,
    opts: { sinceMs: number; max: number },
  ): Promise<ListResult> {
    // Read historyId first so nothing that arrives during the listing is missed.
    const profile = await getJson<{ historyId: string }>(
      `${API}/profile`,
      accessToken,
    );
    const q = new URLSearchParams({
      q: `in:inbox after:${Math.floor(opts.sinceMs / 1000)}`,
      maxResults: String(opts.max),
    });
    const list = await getJson<{ messages?: Array<{ id: string }> }>(
      `${API}/messages?${q}`,
      accessToken,
    );
    // The API returns newest first; callers expect oldest first.
    const ids = (list.messages ?? []).map((m) => m.id).reverse();
    return { ids, cursor: profile.historyId };
  }

  async get(
    accessToken: string,
    id: string,
    mailboxAddress: string,
  ): Promise<MailMessage | null> {
    let m: GmailMessage;
    try {
      m = await getJson<GmailMessage>(
        `${API}/messages/${encodeURIComponent(id)}?format=full`,
        accessToken,
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
    const headers = m.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
      null;
    const labels = new Set(m.labelIds ?? []);
    const replyTo = header('Reply-To');
    const threadId = m.threadId ?? null;

    return {
      providerId: m.id,
      threadId,
      webLink: threadId
        ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailboxAddress)}#all/${threadId}`
        : null,
      from: parseAddress(header('From') ?? 'unknown'),
      replyTo: replyTo
        ? replyTo.split(',').map((r) => parseAddress(r).address)
        : [],
      subject: header('Subject') ?? '',
      receivedAt: new Date(Number(m.internalDate ?? Date.now())),
      snippet: decodeEntities(m.snippet ?? ''),
      bodyText: extractText(m.payload).slice(0, MAX_BODY_CHARS),
      headers: {
        authenticationResults: header('Authentication-Results'),
        listUnsubscribe: !!header('List-Unsubscribe'),
        precedenceBulk: /^(bulk|list|junk)$/i.test(header('Precedence') ?? ''),
      },
      providerHints: {
        promotions: labels.has('CATEGORY_PROMOTIONS'),
        social: labels.has('CATEGORY_SOCIAL'),
        focusedOther: false,
      },
    };
  }
}

const b64url = (data: string) =>
  Buffer.from(data, 'base64url').toString('utf8');

/** Prefer text/plain anywhere in the MIME tree; fall back to stripped HTML. */
function extractText(part: GmailPart | undefined): string {
  if (!part) return '';
  const plain = findPart(part, 'text/plain');
  if (plain?.body?.data) return b64url(plain.body.data).trim();
  const html = findPart(part, 'text/html');
  if (html?.body?.data) return htmlToText(b64url(html.body.data));
  return '';
}

function findPart(part: GmailPart, mime: string): GmailPart | undefined {
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return undefined;
}
