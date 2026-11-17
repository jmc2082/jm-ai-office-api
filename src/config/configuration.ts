// Typed app config. Locally values come from .env; in production they are
// injected from SSM Parameter Store into the container environment.
export interface AppConfig {
  port: number;
  databasePath: string;
  corsOrigins: string[];
  queueConcurrency: number;
  schedulerEnabled: boolean;
  ai: {
    // "mock" returns canned output with fake token counts (no API calls, no cost).
    mode: 'live' | 'mock';
  };
  auth: {
    disabled: boolean;
    cognitoUserPoolId?: string;
    cognitoClientId?: string;
  };
  mail: MailConfig;
}

export interface MailConfig {
  /** base64 32-byte key that encrypts stored refresh tokens. Unset = mail disabled. */
  tokenKey?: string;
  /** OAuth redirect base; the provider name is appended (…/callback/gmail). */
  oauthRedirectBase: string;
  google: { clientId?: string; clientSecret?: string };
  microsoft: { clientId?: string; clientSecret?: string; tenant: string };
  /** Addresses (a@b.com) or domains (b.com) that always need attention. */
  vipSenders: string[];
  /** UTC hour after which the daily digest card is created. */
  digestHourUtc: number;
  /** How far back the first sync of a new mailbox looks. */
  lookbackHours: number;
  /** Max new messages triaged per mailbox per run (bounds cost). */
  maxPerRun: number;
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());

export default (): AppConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const port = parseInt(process.env.PORT ?? '4100', 10);
  const config: AppConfig = {
    port,
    databasePath: process.env.DATABASE_PATH ?? './data/office.db',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY ?? '2', 10),
    schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
    ai: {
      mode: process.env.AI_MODE === 'live' ? 'live' : 'mock',
    },
    auth: {
      disabled: bool(process.env.AUTH_DISABLED, false),
      cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
      cognitoClientId: process.env.COGNITO_CLIENT_ID,
    },
    mail: {
      tokenKey: process.env.MAIL_TOKEN_KEY || undefined,
      oauthRedirectBase: (
        process.env.MAIL_OAUTH_REDIRECT_BASE ??
        `http://localhost:${port}/api/mail/oauth/callback`
      ).replace(/\/+$/, ''),
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || undefined,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
      },
      microsoft: {
        clientId: process.env.MS_CLIENT_ID || undefined,
        clientSecret: process.env.MS_CLIENT_SECRET || undefined,
        tenant: process.env.MS_TENANT || 'organizations',
      },
      vipSenders: list(process.env.MAIL_VIP_SENDERS),
      digestHourUtc: parseInt(process.env.MAIL_DIGEST_HOUR_UTC ?? '13', 10),
      lookbackHours: parseInt(process.env.MAIL_LOOKBACK_HOURS ?? '24', 10),
      maxPerRun: parseInt(process.env.MAIL_MAX_PER_RUN ?? '50', 10),
    },
  };

  if (isProd && config.auth.disabled) {
    throw new Error('AUTH_DISABLED cannot be true in production');
  }
  if (
    !config.auth.disabled &&
    (!config.auth.cognitoUserPoolId || !config.auth.cognitoClientId)
  ) {
    throw new Error(
      'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required unless AUTH_DISABLED=true',
    );
  }
  return config;
};
