# JM Office of AI Workers — Roadmap

Owner: Joshua Mackey
Created: 2026-11-02
Updated: 2026-11-05
Status: Phase 0a + 0b done (local API + dashboard) → Phase 0c (deploy): CloudFormation templates written, not yet deployed

A personal, **project-agnostic** worker platform that automates the repeatable parts of my engineering week. These include testing, releases, inbox triage, analytics, email marketing, social and support. Narrow AI "workers" run on a schedule and surface anything consequential as a card for me to approve.

It is a generic system and not tied to any one client or codebase. Projects are things workers point *at*, not things the platform is built *around*. Decisions get made as the system grows, and workers are added in small segments, never all at once.

---

## 1. Principles (non-negotiable)

1. **Approval gate.** Anything that sends, publishes, deploys, or spends money becomes a **card** in the Needs You queue. Nothing does those actions on its own. A worker may graduate to auto-execution for one narrow category only after a sustained record of approvals without edits, and only by an explicit config change.
2. **One worker, one job.** Each worker is a small module with a single responsibility, a schedule, and a model assignment. No general-purpose "do everything" agent.
3. **Deterministic where possible.** AI writes and repairs things such as tests, drafts and reports. AI does not judge pass/fail where code can.
4. **Cost is a first-class metric.** Every run logs its tokens and computed cost. A spend cap is set in the Anthropic Console on a dedicated key before anything runs on a schedule.
5. **Simple until proven otherwise.** One box, one database file, one language (TypeScript). Scale up only at the defined trigger points (§9).
6. **Generic first.** No worker, table or screen hard-codes a specific client or project. Project-specific details live in config or the worker's payload.
7. **Grow in segments.** Ship one worker at a time, end to end, before starting the next.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vue 3 + TypeScript, Composition API (`<script setup>`), Pinia, Vue Router | Deployed to **AWS Amplify** from git |
| UI | Tailwind CSS v4 (`@tailwindcss/vite`) + Flowbite (plugin + component classes) | Avoid `flowbite-vue`; it lags core |
| Auth | **Amazon Cognito** user pool (single user) | JWT validated by a Nest guard on every request; dev bypass locally |
| API + workers | **NestJS** (TypeScript) | Docker on a single **EC2 t3.micro** (x86, us-east-2); see `planning/aws-cloudformation-planning/` |
| Scheduling | `@nestjs/schedule` | Cron lives in code, versioned with the workers |
| Job queue | In-process queue, concurrency 1–2 | Keeps Playwright / Claude Code runs from starving the box |
| Live updates | **Server-Sent Events** from Nest | One-way feed for Happening Now, stats and Needs You |
| Reverse proxy / TLS | **Caddy** | Automatic certificates |
| Database | **SQLite** on EBS via **Drizzle ORM** | JSON column for per-worker payloads; Drizzle migrations only (no loose `.sql` files) |
| Backups | **Litestream** → S3 | Continuous replication |
| Secrets | **SSM Parameter Store** (SecureString) | Free; avoid Secrets Manager per-secret fees |
| AI | Anthropic API, task-to-model routing config | Batch API + prompt caching where applicable |
| Testing | **Playwright** (browser E2E + API via request context) | Runs in GitHub Actions and in the worker container |
| CI/CD | GitHub Actions → AWS / Amplify | |

### Decisions and why

- **EC2 + Docker over Lambda/API Gateway.** Workers are long-running jobs: headless Claude Code sessions, Playwright runs, multi-step drafting. They hit Lambda's 15-minute cap and API Gateway's timeouts. Playwright on Lambda requires custom container images. A persistent disk enables SQLite. Lambda remains an option for isolated pieces later (e.g. a chat webhook receiver).
- **SQLite over MongoDB, DynamoDB, MySQL/MariaDB, Postgres (for now).**
  - The data is relational (workers → runs → cards) and the dashboard is joins and aggregates.
  - Per-worker variability is handled by a JSON column.
  - There is no extra server to run, secure or back up.
  - MongoDB would compete with Chromium for RAM on a small instance.
  - DynamoDB's access-pattern-first design suits Lambda, not ad hoc dashboard queries.
  - Postgres is the defined upgrade path (§9). Drizzle supports both, so migration is mostly a driver and dialect change.
- **SSE over socket.io.** The UI only needs server → browser updates. Approvals go through normal HTTP calls. SSE needs no extra library and passes through Caddy cleanly.
- **In-process queue over Redis/SQS.** One box, one process. The queue is a small concurrency limiter in front of `worker.base.ts`. Replace it only if a trigger in §9 is hit.

### Conventions carried over from past projects

- **Backend:** one Nest module per feature (`*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`), `ConfigModule`, global `ValidationPipe`, global route prefix (`/api`), Swagger at `/api/docs`.
- **Frontend:** `useApi` composable over an axios plugin; `layouts/`, `composables/`, `services/`, `stores/`, `interfaces/` folders.
- **Left behind on purpose:** wide-open CORS (lock to the Amplify domain + localhost), committed `.env` files and service-account JSON keys, TypeORM, multiple databases.

---

## 3. Architecture

```
                ┌──────────────────────────────┐
                │  Vue 3 + Flowbite (Amplify)  │
                │  Office · Needs You · Runs   │
                │  Workers · Cost · Replay     │
                └──────────────┬───────────────┘
                               │ HTTPS + Cognito JWT  (REST + SSE)
                ┌──────────────▼───────────────┐
                │  EC2 t3.micro (Docker)       │
                │  ┌────────┐  ┌────────────┐  │
                │  │ Caddy  │→ │  NestJS    │  │
                │  └────────┘  │  API + SSE │  │
                │              │  Scheduler │  │
                │              │  Queue     │  │
                │              │  Workers   │  │
                │              └─────┬──────┘  │
                │        SQLite ◄────┘         │
                │          │ Litestream        │
                └──────────┼───────────────────┘
                           ▼
                        S3 backup

External (added per worker, as needed): Anthropic API · GitHub · Gmail/Graph
          GA4 Data API · GTM API · SES or ESP · Meta Business Suite
```

### Request flow for a gated action

1. The scheduler (or a manual "Run now") enqueues a worker. When the queue starts it, a `runs` row is created with status `running` and a `run_started` event is emitted.
2. The worker gathers its inputs, calls the model chosen in `models.config.ts`, and logs its tokens.
3. If its output needs another worker's review, it emits a `handoff` event targeting that worker.
4. If its output needs a send, publish, deploy or spend, the worker writes a `cards` row with the proposed action in `payload`.
5. I approve in the UI or CLI. The API then executes the action and records the outcome on the card.
6. Every step writes to `events`, which streams to the UI over SSE.

---

## 4. Data model (Drizzle / SQLite)

**workers**: `id`, `slug`, `display_name`, `description`, `department` (`quality|release|inbox|analytics|marketing|social|support|ops|...`), `status` (`trial|active|paused|retired`), `avatar` (seed or URL), `schedule` (cron), `enabled`, `model_task_key`, `implemented` (false for rows with no code, e.g. demo data), `created_at`

**runs**: `id`, `worker_id`, `trigger` (`schedule|manual|handoff`), `input` (JSON from a manual run or hand-off), `queued_at`, `started_at`, `finished_at`, `status` (`queued|running|ok|failed|needs_you`), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `model`, `log` (text), `error` (text)

**cards**: `id`, `run_id`, `worker_id`, `kind` (`email_reply|deploy|publish|send_campaign|gtm_publish|alert|...`), `title`, `summary`, `payload` (JSON), `status` (`open|approved|rejected|executed|failed`), `created_at`, `resolved_at`, `resolution_note`

**events**: `id`, `ts`, `worker_id`, `run_id`, `target_worker_id` (nullable, set for hand-offs), `type` (`run_started|run_finished|run_failed|card_created|card_resolved|handoff|info`), `message`. This is the "Happening Now" feed, the source for the "hand-offs today" stat, and the replay source.

### Dashboard stats (all derived, nothing stored)

| Stat | Source |
|---|---|
| Workers | `count(workers where enabled)` |
| Working now | `count(runs where status = running)` |
| Need you | `count(cards where status = open)` |
| Broken | workers whose latest run `failed` |
| Hand-offs today | `count(events where type = handoff and ts >= today)` |
| Replay | `events` bucketed per 10 minutes |

---

## 5. Model routing

All model choices live in one file, `src/ai/models.config.ts` in the API, keyed by task.

| Task key | Model | Max tokens | Mode |
|---|---|---|---|
| `hello.echo` (Phase 0) | `claude-haiku-5-5` | low | real-time |
| `inbox.classify` | `claude-haiku-5-5` | low | real-time |
| `inbox.draft_reply` | `claude-sonnet-5-5` | medium | real-time, prompt-cached KB |
| `tests.generate` / `tests.repair` | `claude-sonnet-5-5` | high | headless Claude Code |
| `pr.review` | `claude-sonnet-5-5` | medium | GitHub Action |
| `analytics.weekly_report` | `claude-sonnet-5-5` | medium | **Batch API** |
| `email.campaign_copy` | `claude-sonnet-5-5` | medium | real-time |
| `social.draft` | `claude-haiku-5-5` | low | Batch API |
| `debug.hard` | `claude-opus-5-5` | high | manual only |

Rules:
- Each entry carries a prompt version, so output changes can be traced to prompt changes.
- Cost is computed per run from logged tokens and stored on `runs.cost_usd`.
- Non-urgent work goes through the Batch API.
- Long, reused system prompts use prompt caching.

---

## 6. Repository layout

Two GitHub repos, one per deployable app. Each has its own branches, CI and `.gitignore`. Locally they sit side by side in one workspace folder that is not itself a repo.

| Repo | Deploys to | Branches |
|---|---|---|
| `jm-ai-office-api` | EC2 (Docker Compose) via GitHub Actions | `main` deploys; feature branches run CI only |
| `jm-ai-office-of-workers` | AWS Amplify | One Amplify environment per branch (e.g. `main` = prod, `dev` = staging), each with its own `VITE_API_BASE_URL` |

The roadmap lives in the API repo under `planning/`. The frontend's API types in `src/interfaces/office.ts` are hand-copied for now; once they start to drift, generate them from the API's OpenAPI spec (`/api/docs-json`) with `openapi-typescript`.

```
jm-ai-office-of-workers/                # local workspace folder (not a repo)
└── code/
    ├── front-ends/
    │   └── jm-ai-office-of-workers/    # REPO: Vue 3 + Tailwind + Flowbite (Amplify)
    │       └── src/
    │           ├── layouts/            # AppLayout (dark sidebar shell)
    │           ├── views/              # Office, NeedsYou, Runs, Workers, Cost
    │           ├── components/         # shared pieces + office/ (StatsBar, NeedsYouPanel, ...)
    │           ├── composables/        # useApi, useEventStream (SSE), useTheme
    │           ├── plugins/            # axios
    │           ├── services/           # officeApi, authService
    │           ├── stores/
    │           └── interfaces/
    └── backends/
        └── jm-ai-office-api/           # REPO: NestJS API + scheduler + workers
            ├── planning/
            │   ├── roadmaps/           # this file, reference screenshots
            │   └── other/
            ├── src/
            │   ├── auth/               # Cognito JWT guard (+ dev bypass)
            │   ├── db/                 # Drizzle schema + seed
            │   ├── ai/                 # Anthropic client, models.config.ts, cost calc
            │   ├── cards/              # approve/reject/execute
            │   ├── runs/
            │   ├── events/             # event log + SSE stream
            │   ├── stats/              # dashboard aggregates
            │   ├── queue/              # concurrency limiter
            │   ├── scheduler/
            │   └── workers/
            │       ├── worker.base.ts  # lifecycle: start run → work → log → hand-off/card
            │       ├── hello-world/    # Phase 0
            │       └── ...             # one folder per worker, added in segments
            ├── drizzle/                # SQL migrations
            ├── cli/                    # `needs`: list/approve/reject from terminal (Phase 0c)
            ├── infra/                  # Phase 0c
            │   ├── cloudformation/     # github-oidc, dns, data, auth, server stacks (JSON) + deploy.sh
            │   └── host/               # docker-compose.yml, Caddyfile, litestream.yml, deploy.sh (runs on the box)
            ├── .github/workflows/      # deploy.yml: test → build → ECR → SSM deploy
            ├── Dockerfile
            └── drizzle.config.ts
```

Playwright suites for other target projects (later phases) live in the API repo under `e2e/`, next to the workers that run them.

---

## 7. Phases

Phases after Phase 0 are a menu, not a fixed schedule. Each one adds one or two workers, end to end, and they can be reordered as priorities change. Week estimates are rough.

### Phase 0: Foundation + Office dashboard (week 1–2)

**0a: Local foundation (no AWS)**
- Folders per §6 (originally one root repo; split into two repos on 2026-11-05).
- NestJS API: Drizzle schema (§4), `worker.base.ts`, the in-process queue, `models.config.ts`, cost logging, the events table + SSE stream, card approve/reject endpoints, stats endpoint.
- A `hello-world` worker on a cron that calls Haiku, logs tokens and cost, emits a hand-off to a second trivial worker, and creates a card.
- Seed script with a handful of sample workers so the dashboard has something to show.
- `AI_MODE=mock` so the whole loop runs locally with no API key and no cost.
- **Status: done (2026-11-03).** See `code/backends/jm-ai-office-api/README.md`.

**0b: Office dashboard (the main screen)**
- Dark icon sidebar shell (Office, Needs You, Workers, Runs, Cost, Settings).
- Office view: stats bar, Needs You panel with approve/reject, Happening Now feed (SSE), worker roster with avatars and status dots, Replay strip, and a selected-worker card ("Open profile" / "Run now").
- Runs and Workers views.
- **Status: done (2026-11-04).** Also includes Cost view, worker profile, run detail, light/dark theme, mobile layout. API default port moved to 4100 (3000 is commonly taken by other dev servers).

**0c: Deploy**
- Provision EC2 t3.micro (us-east-2), Docker Compose, Caddy, Litestream → S3, all via CloudFormation (`infra/cloudformation/`). Plan: `planning/aws-cloudformation-planning/ec2-cloudformation-plan.md`.
- Cognito user pool and the Nest JWT guard.
- Dedicated Anthropic API key with a **Console spend cap**.
- Amplify hosting for the frontend.
- `needs` CLI.

- **Exit:** the hello-world worker runs on a schedule in production, logs tokens and cost, hands off, creates a card, and the card can be approved from both CLI and UI while the dashboard updates live.

### Phase 1: Testing (weeks 3–4)
- Playwright E2E + API suites for whichever of my projects ships most often, then others as needed.
- GitHub Actions: run on every PR and against preview deploys.
- `tests.generate` / `tests.repair`: headless Claude Code writes specs from described flows and repairs broken selectors, delivered as PRs for review.
- **Exit:** every PR on covered projects gets an automated E2E + API run, and manual regression testing is retired for covered flows.

### Phase 2: Release support (week 5)
- `smoke-test` worker runs a Playwright subset against production after each deploy and creates an `alert` card on failure.
- Release notes are generated from merged PRs.
- Claude PR review via GitHub Action.
- **Production deploys remain human-triggered.**
- **Exit:** every production deploy is followed by an automatic smoke check within minutes.

### Phase 3: Inbox triage and support drafting (weeks 6–7)
- Gmail API / Microsoft Graph read access per mailbox.
- `inbox.classify` labels each message as sales, support, tech or noise.
- `inbox.draft_reply` writes a draft and creates an `email_reply` card. **I send. No auto-send.**
- Build a support knowledge base from resolved threads and use it as a prompt-cached context.
- **Exit:** all inbound mail is labeled within minutes and support or tech mail arrives with a draft attached.

### Phase 4: Analytics (week 8)
- `ga4-report` produces a weekly GA4 Data API report via the Batch API. It flags anomalies such as traffic drops, conversions falling to zero, or tags that have stopped firing.
- `gtm-backup` exports GTM container versions nightly into git for diffs and rollback history.
- GTM changes can be proposed as cards. **Publishing a container is always gated.**
- **Exit:** the weekly report lands automatically and every GTM change is diffable in git.

### Phase 5: Email marketing (week 9)
- An MJML compile pipeline produces HTML and plain-text versions.
- Send through an ESP API. **Decide between SES (cheap, but list management, unsubscribe and bounce suppression are mine to build) and a hosted ESP (paid, but handles compliance).**
- `email.campaign_copy` drafts; the `send_campaign` card is gated.
- **Exit:** a campaign goes from MJML to an approved send without manual copy-paste.

### Phase 6: Social (week 10+)
- `social.draft` drafts posts via the Batch API, and I schedule them natively in Meta Business Suite or a scheduler.
- **No direct API posting yet.** Meta requires app review, X's API is paid (check current pricing first), and LinkedIn's posting API is restrictive.
- **Exit:** a weekly batch of drafts is ready to schedule.

### Phase 7: Live chat assist
- Suggested replies come from the support knowledge base, shown to a human operator.
- **No unsupervised customer-facing bot.**
- A Lambda webhook receiver is acceptable here if the chat provider requires a push endpoint.

### Later: Isometric office view
- An isometric "office floor" with workers at desks grouped by `department`, animated by the same `runs`, `cards` and `events` data. It is purely presentational and requires no backend changes. The dashboard panels around it ship in Phase 0.
- Possible follow-on: "Ask <worker>" — chat with a worker about its recent runs.

---

## 8. Cost budget (approximate; verify current pricing)

| Item | Estimate / month | Notes |
|---|---|---|
| EC2 t3.micro + EBS + Elastic IP + Route 53 zone | ~$13.50 | Main fixed cost (free tier has ended on this account) |
| S3 (Litestream) | < $1 | |
| Amplify hosting | ~$0–5 | Low traffic |
| Cognito | $0 | Free at one user |
| SSM Parameter Store | $0 | Standard tier |
| GitHub Actions | within plan or low | Playwright minutes are the driver |
| Anthropic API | **variable, capped** | Hard cap in Console; tracked per worker in `runs.cost_usd` |
| SES / ESP | volume-dependent | Decided in Phase 5 |

Review the Cost view weekly. Any worker whose cost outweighs the time it saves gets downgraded to a cheaper model, batched, or retired.

---

## 9. Upgrade triggers

| Trigger | Move to |
|---|---|
| Need for multiple API instances or concurrent writers | **Postgres** (`jsonb` for payloads), Drizzle dialect swap |
| Box memory pressure (Playwright + API) | t3.small / t3.medium (in-place resize), or move Playwright runs fully to GitHub Actions |
| Queue backlog regularly delays scheduled runs | Raise concurrency, then a separate worker process, then SQS |
| One worker needs independent scale or a public webhook | Extract that worker to Lambda |
| A card category has sustained approval with no edits | Explicit config flag allowing auto-execution for that category only |
| Workers regularly need per-project settings | Add a `projects` table and a `project_id` on runs/cards (see §11) |

MongoDB, DynamoDB and MySQL/MariaDB are **not** on the upgrade path.

---

## 10. Security

- All API routes are behind the Cognito JWT guard, and Caddy terminates TLS. The SSE stream is authenticated too.
- CORS allows only the Amplify domain and localhost.
- Secrets live only in SSM Parameter Store. Nothing goes in `.env` files committed to git; a `.env.example` documents the keys for local dev.
- OAuth tokens (Gmail/Graph/GA/GTM) use least-privilege scopes, starting read-only and adding send or publish scopes only at the phase that needs them.
- The EC2 security group allows 443 publicly and SSH only from my IP (or SSM Session Manager with no SSH).
- Content from emails, web pages and tickets is treated as data, never as instructions to a worker. Workers cannot act on instructions found in the content they process.

---

## 11. Scope

- The platform is standalone and not integrated with any other worker system.
- It is not specific to any client. Workers that touch a client's systems (mailboxes, analytics, sites) must follow that client's own rules for sending mail, publishing and data access. Those rules are captured in the worker's config before it is enabled.
- Whether to model "projects" as a first-class table is deferred until a second worker actually needs per-project settings (§9).

---

## 12. Open decisions

1. Which project gets Playwright coverage first (the one that ships most often).
2. SES vs hosted ESP for campaigns (Phase 5).
3. Which mailboxes are in scope for triage, and which providers they use (Gmail vs Microsoft).
4. When to introduce a `projects` table (§9, §11).
5. Which worker comes right after Phase 0. Phase 1 is the default, but any phase can go next.
