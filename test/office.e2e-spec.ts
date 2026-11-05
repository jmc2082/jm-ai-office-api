import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { QueueService } from '../src/queue/queue.service.js';

describe('Office (e2e)', () => {
  let app: INestApplication;
  let queue: QueueService;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_PATH: ':memory:',
      AUTH_DISABLED: 'true',
      SCHEDULER_ENABLED: 'false',
      AI_MODE: 'mock',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    queue = app.get(QueueService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('syncs code-backed workers on boot', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workers')
      .expect(200);
    expect(res.body.map((w: { slug: string }) => w.slug).sort()).toEqual([
      'hello-reviewer',
      'hello-world',
    ]);
  });

  it('runs a worker, hands off, creates a card, and executes it on approval', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/workers/hello-world/run')
      .send({ input: { topic: 'tests' } })
      .expect(201);

    // Resolves after the run and the hand-off run it queues have both finished.
    await queue.onIdle();

    const runs = await request(server).get('/api/runs').expect(200);
    expect(runs.body.map((r: { status: string }) => r.status).sort()).toEqual([
      'needs_you',
      'ok',
    ]);
    expect(runs.body.every((r: { costUsd: number }) => r.costUsd > 0)).toBe(
      true,
    );

    const stats = await request(server).get('/api/stats').expect(200);
    expect(stats.body).toMatchObject({
      needYou: 1,
      handoffsToday: 1,
      workingNow: 0,
    });

    const open = await request(server)
      .get('/api/cards?status=open')
      .expect(200);
    expect(open.body).toHaveLength(1);

    const approved = await request(server)
      .post(`/api/cards/${open.body[0].id}/approve`)
      .send({})
      .expect(201);
    expect(approved.body.status).toBe('executed');
    expect(approved.body.resolutionNote).toMatch(/Published greeting/);

    await request(server)
      .post(`/api/cards/${open.body[0].id}/approve`)
      .send({})
      .expect(400);
  });

  it('finishes a run with nothing to approve as ok', async () => {
    const server = app.getHttpServer();
    const before = (await request(server).get('/api/runs').expect(200)).body
      .length;
    await request(server)
      .post('/api/workers/hello-reviewer/run')
      .send({})
      .expect(201);
    await queue.onIdle();
    const runs = (await request(server).get('/api/runs').expect(200)).body;
    expect(runs.length).toBe(before + 1);
    expect(runs[0].status).toBe('ok');
  });

  it('groups replay events into 10-minute buckets', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/replay')
      .expect(200);
    expect(res.body.buckets.length).toBeGreaterThan(0);
    for (const b of res.body.buckets) {
      expect(new Date(b.bucket).getTime() % res.body.bucketMs).toBe(0);
    }
  });

  it('rejects unknown body fields', async () => {
    await request(app.getHttpServer())
      .patch('/api/workers/hello-world')
      .send({ schedule: '* * * * *' })
      .expect(400);
  });
});
