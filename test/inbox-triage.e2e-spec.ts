import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import type { MailMessage } from '../src/mail/mail.types.js';
import { QueueService } from '../src/queue/queue.service.js';

const auth = (dmarc: string) =>
  `mx.google.com; spf=pass; dkim=pass; dmarc=${dmarc}`;

const message = (id: string, over: Partial<MailMessage>): MailMessage => ({
  providerId: id,
  threadId: `t-${id}`,
  webLink: `https://mail.example/${id}`,
  from: { name: null, address: 'someone@example.com' },
  replyTo: [],
  subject: `Subject ${id}`,
  receivedAt: new Date(),
  snippet: `snippet ${id}`,
  bodyText: `body ${id}`,
  headers: {
    authenticationResults: auth('pass'),
    listUnsubscribe: false,
    precedenceBulk: false,
  },
  providerHints: { promotions: false, social: false, focusedOther: false },
  ...over,
});

const INBOX: Record<string, MailMessage> = {
  vip: message('vip', { from: { name: 'Boss', address: 'boss@acme.com' } }),
  spoof: message('spoof', {
    from: { name: 'Boss', address: 'boss@acme.com' },
    headers: {
      authenticationResults: auth('fail'),
      listUnsubscribe: false,
      precedenceBulk: false,
    },
  }),
  spam: message('spam', {
    headers: {
      authenticationResults: auth('fail'),
      listUnsubscribe: false,
      precedenceBulk: false,
    },
  }),
  promo: message('promo', {
    headers: {
      authenticationResults: auth('pass'),
      listUnsubscribe: true,
      precedenceBulk: false,
    },
    providerHints: { promotions: true, social: false, focusedOther: false },
  }),
  // Goes to the (mock) model, whose non-JSON reply exercises the fallback.
  unclear: message('unclear', {}),
};

describe('Inbox triage (e2e)', () => {
  let app: INestApplication;
  let queue: QueueService;
  let mail: MailService;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_PATH: ':memory:',
      AUTH_DISABLED: 'true',
      SCHEDULER_ENABLED: 'false',
      AI_MODE: 'mock',
      MAIL_TOKEN_KEY: randomBytes(32).toString('base64'),
      MAIL_VIP_SENDERS: 'acme.com',
      MAIL_DIGEST_HOUR_UTC: '0',
      GOOGLE_CLIENT_ID: 'test-client',
      GOOGLE_CLIENT_SECRET: 'test-secret',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    queue = app.get(QueueService);
    mail = app.get(MailService);

    const gmail = mail.provider('gmail');
    vi.spyOn(gmail, 'refresh').mockResolvedValue({
      accessToken: 'access',
      expiresAt: Date.now() + 3_600_000,
    });
    let cursor = 0;
    vi.spyOn(gmail, 'listNew').mockImplementation(async () => ({
      ids: Object.keys(INBOX), // same IDs every run: dedupe must hold
      cursor: String(++cursor),
    }));
    vi.spyOn(gmail, 'get').mockImplementation(
      async (_t, id) => INBOX[id] ?? null,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a provider sign-in URL with PKCE and rejects a forged callback', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/api/mail/connect/gmail')
      .send({ label: 'personal' })
      .expect(201);
    const url = new URL(res.body.url);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/gmail.readonly',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const cb = await request(server)
      .get('/api/mail/oauth/callback/gmail?state=forged&code=x')
      .expect(400);
    expect(cb.text).toContain('expired or invalid');
  });

  it('triages new mail into cards and a digest, then dedupes on the next run', async () => {
    const server = app.getHttpServer();
    mail.upsertConnected('gmail', 'me@gmail.com', 'refresh-token', 'personal');

    await request(server)
      .post('/api/workers/inbox-triage/run')
      .send({})
      .expect(201);
    await queue.onIdle();

    const runs = await request(server).get('/api/runs').expect(200);
    expect(runs.body[0]).toMatchObject({ status: 'needs_you' });

    const cards = (
      await request(server).get('/api/cards?status=open').expect(200)
    ).body as Array<{
      kind: string;
      title: string;
      summary: string;
    }>;
    expect(cards.map((c) => c.kind).sort()).toEqual([
      'inbox_attention',
      'inbox_digest',
      'inbox_phishing',
    ]);
    const digest = cards.find((c) => c.kind === 'inbox_digest')!;
    expect(digest.title).toBe('Inbox digest: 3 emails, 1 likely spam');
    expect(digest.summary).toContain('Likely spam (1)');

    const messages = (
      await request(server).get('/api/mail/messages').expect(200)
    ).body as Array<{
      providerMessageId: string;
      verdict: string;
      decidedBy: string;
    }>;
    const byId = Object.fromEntries(
      messages.map((m) => [m.providerMessageId, m]),
    );
    expect(byId.vip).toMatchObject({
      verdict: 'needs_attention',
      decidedBy: 'rules',
    });
    expect(byId.spoof).toMatchObject({
      verdict: 'phishing',
      decidedBy: 'rules',
    });
    expect(byId.spam).toMatchObject({
      verdict: 'likely_spam',
      decidedBy: 'rules',
    });
    expect(byId.promo).toMatchObject({
      verdict: 'newsletter',
      decidedBy: 'rules',
    });
    expect(byId.unclear).toMatchObject({
      verdict: 'fyi',
      decidedBy: 'fallback',
    });

    // Second run sees the same IDs: nothing new, no new cards, still only one digest today.
    await request(server)
      .post('/api/workers/inbox-triage/run')
      .send({})
      .expect(201);
    await queue.onIdle();
    expect(
      (await request(server).get('/api/mail/messages').expect(200)).body,
    ).toHaveLength(5);
    expect(
      (await request(server).get('/api/cards?status=open').expect(200)).body,
    ).toHaveLength(3);

    const boxes = (await request(server).get('/api/mail/mailboxes').expect(200))
      .body;
    expect(boxes.mailboxes[0]).toMatchObject({
      address: 'me@gmail.com',
      status: 'active',
      label: 'personal',
    });
    expect(boxes.mailboxes[0]).not.toHaveProperty('refreshTokenEnc');
  });
});
