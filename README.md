# jm-ai-office-api

NestJS API, scheduler and workers for the JM Office of AI Workers.
See the [roadmap](planning/roadmaps/jm-automated-AI-BOT-Systems-ROADMAP.md) for the full plan.

## Quick start

```bash
npm install
cp .env.example .env      # mock AI + auth disabled by default
npm run db:seed:demo      # optional: demo workers, runs and cards
npm run start:dev
```

- API: http://localhost:4100/api
- Swagger docs: http://localhost:4100/api/docs
- Live feed (SSE): http://localhost:4100/api/events/stream

The SQLite file lives at `./data/office.db` and migrations run automatically on boot.
`npm run db:reset` deletes it.

## How it works

| Piece | Where |
|---|---|
| Schema (`workers`, `runs`, `cards`, `events`) | `src/db/schema.ts` → `npm run db:generate` writes a migration to `drizzle/` |
| Model per task, pricing | `src/ai/models.config.ts` |
| Model calls (live or mock) | `src/ai/ai.service.ts` |
| Run lifecycle, hand-offs, cost logging | `src/workers/worker-runner.service.ts` |
| Cron jobs | `src/scheduler/scheduler.service.ts` |
| Concurrency limit | `src/queue/` (`QUEUE_CONCURRENCY`) |
| Approve / reject | `src/cards/` |
| Dashboard numbers | `src/stats/` |
| Auth (Cognito access token) | `src/auth/cognito-auth.guard.ts` |

A run goes `queued → running → ok | needs_you | failed`. A run that creates a card ends as
`needs_you`. Hand-offs are queued only after the sending run succeeds.

## Adding a worker

1. Create `src/workers/<name>/<name>.worker.ts` extending `BaseWorker`:
   - `definition`: slug, display name, department, optional cron `schedule` and `modelTaskKey`.
   - `run(ctx)`: do the job using `ctx.ai()`, `ctx.log()`, `ctx.handoff()`, `ctx.createCard()`.
   - `execute(card)` (optional): perform the gated action after you approve a card.
2. Add the class to `WORKER_CLASSES` in `src/workers/index.ts`.
3. Add its task key to `src/ai/models.config.ts` if it calls a model.

The worker row is created or updated on the next boot. `enabled` and `status` are managed
from the UI and are never overwritten by code.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Public |
| GET | `/api/stats?since=ISO` | Workers, working now, need you, broken, hand-offs today, cost today |
| GET | `/api/stats/replay?since=ISO` | Events per 10-minute bucket |
| GET | `/api/stats/cost?days=30` | Cost per day per worker |
| GET | `/api/workers` / `/api/workers/:idOrSlug` | With last run, open cards, next run |
| PATCH | `/api/workers/:idOrSlug` | `{ enabled?, status? }` |
| POST | `/api/workers/:idOrSlug/run` | Run now, `{ input? }` |
| GET | `/api/runs` / `/api/runs/:id` | Detail includes log, cards and events |
| GET | `/api/cards?status=open` / `/api/cards/:id` | |
| POST | `/api/cards/:id/approve` / `reject` | `{ note? }` |
| GET | `/api/events` / `/api/events/stream` | History / live SSE (`event` and `ping` messages) |

`since` lets the browser define "today" as its own local midnight.

## Environment

See `.env.example`. Notes:

- `AI_MODE=mock` (default) makes no API calls and costs nothing. Set `live` plus
  `ANTHROPIC_API_KEY` (a dedicated key with a Console spend cap) for real calls.
- `AUTH_DISABLED=true` is for local dev and is refused when `NODE_ENV=production`.
- The SSE route also accepts `?access_token=` because `EventSource` can't send headers.

## Tests

```bash
npm test          # unit
npm run test:e2e  # boots the app on an in-memory DB and runs the full worker → card → approve flow
```
