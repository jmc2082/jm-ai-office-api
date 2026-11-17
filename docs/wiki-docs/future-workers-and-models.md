# Future workers and choosing a model

## Workers that fit this platform

A good worker does one repeatable job, has a clear input, and produces something you can check:
a report, a draft, a pass/fail, a pull request. These come from the roadmap's phases. Phases are a
menu, not a fixed order; build one worker at a time, end to end.

| Area | Worker | What it would do | Card it would raise | Model task |
|---|---|---|---|---|
| Testing | Test writer | Writes Playwright specs from a described flow, delivered as a PR | "Merge new tests?" | `tests.generate` |
| Testing | Test repairer | Fixes broken selectors after UI changes, as a PR | "Merge test fix?" | `tests.repair` |
| Release | Smoke tester | Runs a Playwright subset against production after each deploy | `alert` on failure | none (pure code) |
| Release | Release notes | Writes notes from merged PRs | "Publish release notes?" | `pr.review` or a new key |
| Release | PR reviewer | Reviews pull requests and comments | "Post review?" | `pr.review` |
| Inbox | Triage | Labels and sorts incoming mail | none (labels only) | `inbox.classify` |
| Inbox | Reply drafter | Drafts support replies | "Send this reply?" | `inbox.draft_reply` |
| Analytics | Weekly report | Summarizes GA4 numbers and flags anomalies | none, or "Send report?" | `analytics.weekly_report` |
| Analytics | GTM backup | Nightly export of the GTM container | none (pure code) | none |
| Marketing | Campaign copy | Drafts email campaign copy | "Schedule campaign?" | `email.campaign_copy` |
| Social | Social drafts | Drafts a weekly batch of posts | "Publish these posts?" | `social.draft` |
| Support | Live chat assist | Suggests replies during live chat | per reply | new key |

The task keys in the last column already exist in [`src/ai/models.config.ts`](../../src/ai/models.config.ts),
so the model choice is made before the worker is written.

**Good patterns to reuse:**

- **Maker + checker.** One worker drafts, a second reviews and raises the card (Echo → Proof).
- **Code first, model second.** Run the deterministic checks in code, and use the model only for
  judgement or writing.
- **No card for read-only work.** Labelling, backups and reports that go nowhere don't need
  approval. Anything that leaves the system does.

## Choosing a model

Every model call goes through a **task key** in `models.config.ts`. A worker never names a model
directly, so you can move a task to a cheaper or stronger model in one place.

```ts
'inbox.classify': {
  model: 'claude-haiku-5-5', // which model
  maxTokens: 256,            // hard cap on the reply length
  effort: 'low',             // how hard the model thinks: low | medium | high | xhigh | max
  promptVersion: 'v1',       // bump when you change the prompt
  mode: 'realtime',          // realtime | batch | claude-code | manual
},
```

### Which model for which job

Prices are per million tokens (input / output), current as of November 2026.

| Model | ID | Price | Use it for | Typical effort |
|---|---|---|---|---|
| **Haiku 5.5** | `claude-haiku-5-5` | $0.10 / $0.50 | Simple, high-volume work: classify, label, extract fields, short drafts, one-line reviews | `low` |
| **Sonnet 5.5** | `claude-sonnet-5-5` | $2 / $10 | Everyday real work: support replies, PR review, reports, campaign copy, writing tests | `medium`, or `high` for code |
| **Opus 5.5** | `claude-opus-5-5` | $4 / $20 | Hard problems: debugging, multi-step reasoning, anything where being wrong is expensive | `high` |

Rules of thumb:

- **Start with the cheapest model that does the job well.** Try Haiku first for anything short and
  well defined. Move up only when the output isn't good enough.
- **Try a lower effort before a bigger model.** Effort is the cheaper knob; Sonnet at `medium` is
  often enough where you might reach for Opus.
- **Set `maxTokens` to what the job needs.** 256 for a label, 1–2K for a short draft, 8–16K for
  reports and code. Thinking also counts against it, so don't set it too tight on harder tasks.
- **Watch the Cost page.** If a worker costs more than the time it saves, lower its effort, move
  it to a cheaper model, batch it, or retire it.

### Modes

| Mode | Meaning | Status today |
|---|---|---|
| `realtime` | A normal API call while the run waits | Works |
| `batch` | Meant for the Batch API (half price, results within hours) | **Not built yet.** The call is still made in real time, but the cost is logged at the batch (50%) price, so it under-reports. Use `realtime` until batch support is added. |
| `claude-code` | Meant for headless Claude Code sessions that edit a repo (test writer/repairer) | **Not built yet** (Phase 1) |
| `manual` | Only run by hand, for expensive tasks like `debug.hard` | Works like `realtime`; just don't schedule it |

### Adding a new task key

Add an entry to `MODEL_TASKS` in `src/ai/models.config.ts` with a new key (for example
`release.notes`), then use that key in the worker's `ctx.ai(...)` call and in its definition's
`modelTaskKey`. If you use a model that isn't in `MODEL_PRICING` yet, add its prices there too, or
the cost on each run will be wrong.
