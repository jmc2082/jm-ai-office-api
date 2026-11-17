# System overview

The JM Office of AI Workers is a personal platform that takes over the repeatable parts of an
engineering week: testing, release checks, inbox triage, analytics reports, marketing drafts. The
work is done by small AI **workers**. Each worker has one job, runs on a schedule or on demand,
and asks you before it does anything that matters.

It is generic on purpose. Workers point *at* projects; the platform is not built around any one
client or codebase.

## The rules every worker follows

1. **Approval gate.** Anything that sends, publishes, deploys or spends money becomes a **card**
   in the *Needs you* queue. Nothing happens until you approve it.
2. **One worker, one job.** No do-everything agent.
3. **Code decides where it can.** Pass/fail, length limits, schema checks and the like are done in
   code. The model writes, summarizes and drafts.
4. **Every model call is costed.** Tokens and dollars are logged on each run.
5. **Content is data, not instructions.** Text a worker reads (emails, pages, tickets) can never
   tell it what to do.

## The two parts

| | Backend (`jm-ai-office-api`) | Frontend (`jm-ai-office-of-workers`) |
|---|---|---|
| What it is | NestJS API, scheduler, job queue and the workers themselves | Vue 3 dashboard |
| Live at | https://api.office.wikiboost.com/api | https://office.wikiboost.com |
| Runs on | One EC2 t3.micro in us-east-2, in Docker (Caddy → API, plus Litestream) | AWS Amplify (static site) |
| Data | SQLite at `/opt/jm-office/data/office.db`, copied to S3 continuously by Litestream | None of its own; reads everything from the API |
| Sign-in | Checks a Cognito access token on every request | Cognito sign-in page at `/login` |
| Deploys | Push to `main` → GitHub Actions → image to ECR → SSM command on the box | Push to `main` → GitHub Actions → build → Amplify |
| Infrastructure | CloudFormation in `infra/cloudformation/` (all stacks, including the web one) | — |

### Backend

The backend does all the work. The pieces:

| Piece | Where | What it does |
|---|---|---|
| Workers | `src/workers/<name>/` | The jobs. Each is a class with a definition and a `run()` method. |
| Runner | `src/workers/worker-runner.service.ts` | Starts runs, records logs, tokens and cost, handles hand-offs and cards |
| Scheduler | `src/scheduler/` | One cron job per enabled worker that has a schedule |
| Queue | `src/queue/` | Runs at most `QUEUE_CONCURRENCY` jobs at once (1 in production) |
| Model routing | `src/ai/models.config.ts` | Which model, token limit and effort each task uses |
| Model calls | `src/ai/ai.service.ts` | Calls Claude (`AI_MODE=live`) or returns canned text (`AI_MODE=mock`) |
| Cards | `src/cards/` | Approve / reject. Approving calls the worker's `execute()`. |
| Events | `src/events/` | The activity log and the live feed (Server-Sent Events) |
| Stats | `src/stats/` | The dashboard numbers: working now, needs you, cost today... |

The database has four tables: `workers`, `runs`, `cards` and `events`.

### Frontend

The dashboard is where you watch and steer the workers:

| Page | What it shows |
|---|---|
| **Office** (`/`) | Stats bar, workers by department, the selected worker, *Needs you*, *Happening now* (live), Replay |
| **Needs you** | Open approval cards with notes, plus what you resolved before |
| **Workers** | Every worker; each profile has the on/off switch, status, *Run now*, recent runs |
| **Runs** | Every run with filters; a run shows its log, tokens, cost, cards and events |
| **Cost** | Total and daily spend, and spend per worker |

The dashboard keeps one live connection to the API and refreshes when anything happens, so you
don't need to reload.

## How a run works

```
schedule / Run now / hand-off
        │
        ▼
   queued ──► running ──► ok            (nothing to approve)
                      ├─► needs_you     (made a card; waits for you)
                      └─► failed        (error is on the run)
```

1. The scheduler, a *Run now* click, or another worker's hand-off queues a run.
2. The worker runs. It can log lines, call a model, hand work to another worker, or create a card.
3. Tokens and cost from every model call are added to the run.
4. A run that created a card ends as **needs_you**. Approve the card and the worker's `execute()`
   does the actual action; reject it and nothing happens.
5. Hand-offs are only sent if the sending run succeeds.

## Where things are configured

| Setting | Where | Notes |
|---|---|---|
| `AI_MODE` (`live` / `mock`) | `infra/cloudformation/params/prod.json` → `AiMode` | Live uses the Anthropic key below |
| Anthropic API key | SSM SecureString `/jm-office/prod/app/ANTHROPIC_API_KEY` | Dedicated `jm-office` workspace with a spend limit in the Claude Console |
| Allowed browser origins | `params/prod.json` → `CorsOrigins` | Currently `https://office.wikiboost.com` |
| Concurrency | `params/prod.json` → `QueueConcurrency` | 1 on the t3.micro |
| Any app setting | SSM under `/jm-office/prod/app/` | Each parameter becomes an environment variable on the next deploy |

After changing a setting, redeploy the API (push to `main`, or *Actions → Deploy API → Run
workflow*) so the container picks it up.

## Cost guardrails

- **Anthropic:** spend limit on the `jm-office` workspace in the Claude Console, plus per-run cost
  on the **Cost** page.
- **AWS:** a $25/month budget (`jm-office-monthly`) that emails you at 80% actual and 100%
  forecast. It counts only resources tagged `Project=jm-office`.

More detail on the AWS side: [`planning/aws-cloudformation-planning/ec2-cloudformation-plan.md`](../../planning/aws-cloudformation-planning/ec2-cloudformation-plan.md).
The full plan and phases: [`planning/roadmaps/jm-automated-AI-BOT-Systems-ROADMAP.md`](../../planning/roadmaps/jm-automated-AI-BOT-Systems-ROADMAP.md).
