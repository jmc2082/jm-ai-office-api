import type { MailProviderKind } from '../db/schema.js';

/** A provider-neutral view of one inbound email. Bodies never leave memory. */
export interface MailMessage {
  providerId: string;
  threadId: string | null;
  webLink: string | null;
  from: { name: string | null; address: string };
  replyTo: string[];
  subject: string;
  receivedAt: Date;
  snippet: string;
  /** Plain text, already truncated. Untrusted. */
  bodyText: string;
  headers: {
    /** The topmost Authentication-Results header (added by the receiving provider). */
    authenticationResults: string | null;
    listUnsubscribe: boolean;
    precedenceBulk: boolean;
  };
  providerHints: {
    /** Gmail CATEGORY_PROMOTIONS */
    promotions: boolean;
    /** Gmail CATEGORY_SOCIAL */
    social: boolean;
    /** Outlook inferenceClassification = "other" (not Focused) */
    focusedOther: boolean;
  };
}

export interface OAuthTokens {
  accessToken: string;
  /** Present on first exchange; Microsoft also rotates it on refresh. */
  refreshToken?: string;
  expiresAt: number;
}

export interface ListResult {
  /** New message IDs, oldest first. */
  ids: string[];
  /** Save after the IDs are processed. */
  cursor: string;
}

export interface MailProviderClient {
  readonly kind: MailProviderKind;
  configured(): boolean;
  authUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  /** The signed-in mailbox address. */
  whoAmI(accessToken: string): Promise<string>;
  listNew(
    accessToken: string,
    cursor: string | null,
    opts: { sinceMs: number; max: number },
  ): Promise<ListResult>;
  /** Null when the message no longer exists. */
  get(
    accessToken: string,
    id: string,
    mailboxAddress: string,
  ): Promise<MailMessage | null>;
}

/** The stored refresh token no longer works; the mailbox must be reconnected. */
export class ReauthRequiredError extends Error {}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: string,
  ) {
    super(message);
  }
}

export const MAX_BODY_CHARS = 4000;
