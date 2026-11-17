import {
  HttpError,
  ReauthRequiredError,
  type OAuthTokens,
} from '../mail.types.js';

const TIMEOUT_MS = 20_000;

export async function getJson<T>(
  url: string,
  accessToken: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Don't echo the URL's query (it can hold cursors); path is enough to debug.
    throw new HttpError(
      res.status,
      `${new URL(url).pathname} returned ${res.status}`,
      body.slice(0, 500),
    );
  }
  return (await res.json()) as T;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

/** POST to an OAuth token endpoint. invalid_grant means the user must reconnect. */
export async function postToken(
  url: string,
  form: Record<string, string>,
): Promise<OAuthTokens> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!res.ok || !json.access_token) {
    const code = json.error ?? `http_${res.status}`;
    if (code === 'invalid_grant')
      throw new ReauthRequiredError(
        'The mailbox sign-in expired or was revoked; reconnect it.',
      );
    throw new Error(`Token endpoint error: ${code}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** "Jane Doe" <jane@x.com>  →  { name, address } */
export function parseAddress(raw: string): {
  name: string | null;
  address: string;
} {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m)
    return { name: m[1]!.trim() || null, address: m[2]!.trim().toLowerCase() };
  return { name: null, address: raw.trim().toLowerCase() };
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}
