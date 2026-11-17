import type { MailConfig } from '../../config/configuration.js';
import {
  HttpError,
  MAX_BODY_CHARS,
  type ListResult,
  type MailMessage,
  type MailProviderClient,
  type OAuthTokens,
} from '../mail.types.js';
import { getJson, parseAddress, postToken } from './http.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE =
  'offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read';
const SELECT = [
  'subject',
  'from',
  'replyTo',
  'receivedDateTime',
  'bodyPreview',
  'body',
  'internetMessageHeaders',
  'inferenceClassification',
  'webLink',
  'conversationId',
].join(',');

interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphAddress;
  replyTo?: GraphAddress[];
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  inferenceClassification?: 'focused' | 'other';
  webLink?: string;
  conversationId?: string;
}

interface DeltaPage {
  value?: Array<{
    id: string;
    receivedDateTime?: string;
    '@removed'?: unknown;
  }>;
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/** Microsoft 365 via Graph, delegated Mail.Read. Cursor = Inbox deltaLink. */
export class MicrosoftProvider implements MailProviderClient {
  readonly kind = 'microsoft' as const;

  constructor(private readonly cfg: MailConfig) {}

  private get redirectUri() {
    return `${this.cfg.oauthRedirectBase}/microsoft`;
  }

  private get authority() {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.cfg.microsoft.tenant)}/oauth2/v2.0`;
  }

  configured(): boolean {
    return !!(this.cfg.microsoft.clientId && this.cfg.microsoft.clientSecret);
  }

  authUrl(state: string, codeChallenge: string): string {
    const q = new URLSearchParams({
      client_id: this.cfg.microsoft.clientId!,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.authority}/authorize?${q}`;
  }

  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    return postToken(`${this.authority}/token`, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.redirectUri,
      scope: SCOPE,
      client_id: this.cfg.microsoft.clientId!,
      client_secret: this.cfg.microsoft.clientSecret!,
    });
  }

  /** Microsoft rotates refresh tokens; the caller stores the new one. */
  refresh(refreshToken: string): Promise<OAuthTokens> {
    return postToken(`${this.authority}/token`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE,
      client_id: this.cfg.microsoft.clientId!,
      client_secret: this.cfg.microsoft.clientSecret!,
    });
  }

  async whoAmI(accessToken: string): Promise<string> {
    const me = await getJson<{ mail?: string; userPrincipalName?: string }>(
      `${GRAPH}/me?$select=mail,userPrincipalName`,
      accessToken,
    );
    return (me.mail ?? me.userPrincipalName ?? 'unknown').toLowerCase();
  }

  async listNew(
    accessToken: string,
    cursor: string | null,
    opts: { sinceMs: number; max: number },
  ): Promise<ListResult> {
    const since = new Date(opts.sinceMs).toISOString();
    const initial = `${GRAPH}/me/mailFolders/inbox/messages/delta?$select=receivedDateTime&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`;
    // Only follow links Graph itself handed us.
    let url = cursor?.startsWith(`${GRAPH}/`) ? cursor : initial;
    const fresh: Array<{ id: string; at: number }> = [];

    for (;;) {
      let page: DeltaPage;
      try {
        page = await getJson<DeltaPage>(url, accessToken, {
          Prefer: 'odata.maxpagesize=100',
        });
      } catch (err) {
        // Expired delta token: start over from the lookback window.
        if (err instanceof HttpError && err.status === 410 && url !== initial) {
          url = initial;
          fresh.length = 0;
          continue;
        }
        throw err;
      }
      for (const v of page.value ?? []) {
        if (v['@removed']) continue;
        const at = v.receivedDateTime
          ? Date.parse(v.receivedDateTime)
          : Date.now();
        // Delta also reports read/flag changes on old mail; ignore anything before the window.
        if (at >= opts.sinceMs) fresh.push({ id: v.id, at });
      }
      if (page['@odata.deltaLink']) {
        fresh.sort((a, b) => a.at - b.at);
        return {
          ids: [...new Set(fresh.map((f) => f.id))],
          cursor: page['@odata.deltaLink'],
        };
      }
      if (!page['@odata.nextLink']?.startsWith(`${GRAPH}/`))
        throw new Error(
          'Graph delta returned neither a nextLink nor a deltaLink',
        );
      url = page['@odata.nextLink'];
    }
  }

  async get(accessToken: string, id: string): Promise<MailMessage | null> {
    let m: GraphMessage;
    try {
      m = await getJson<GraphMessage>(
        `${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`,
        accessToken,
        { Prefer: 'outlook.body-content-type="text"' },
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
    const headers = m.internetMessageHeaders ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
      null;
    const from = m.from?.emailAddress;

    return {
      providerId: m.id,
      threadId: m.conversationId ?? null,
      webLink: m.webLink ?? null,
      from: from?.address
        ? {
            name: from.name?.trim() || null,
            address: from.address.toLowerCase(),
          }
        : parseAddress(header('From') ?? 'unknown'),
      replyTo: (m.replyTo ?? [])
        .map((r) => r.emailAddress?.address?.toLowerCase())
        .filter((a): a is string => !!a),
      subject: m.subject ?? '',
      receivedAt: new Date(m.receivedDateTime ?? Date.now()),
      snippet: m.bodyPreview ?? '',
      bodyText: (m.body?.content ?? '').trim().slice(0, MAX_BODY_CHARS),
      headers: {
        authenticationResults: header('Authentication-Results'),
        listUnsubscribe: !!header('List-Unsubscribe'),
        precedenceBulk: /^(bulk|list|junk)$/i.test(header('Precedence') ?? ''),
      },
      providerHints: {
        promotions: false,
        social: false,
        focusedOther: m.inferenceClassification === 'other',
      },
    };
  }
}
