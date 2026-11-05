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
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());

export default (): AppConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const config: AppConfig = {
    port: parseInt(process.env.PORT ?? '4100', 10),
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
