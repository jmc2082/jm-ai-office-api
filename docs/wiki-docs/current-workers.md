# Current workers

There are three real workers today. Two are **examples** (Echo and Proof). They exist to prove the
whole loop works end to end: schedule → model call → cost logging → hand-off → approval card →
execute. They don't touch any outside system and produce nothing you need. The third, **Jest**, is
small but genuinely for you: a daily joke.

Locally, `npm run db:seed:demo` also adds nine **demo** workers so the dashboard has something to
show. Those are not real; see the end of this page.

## Echo (`hello-world`)

| | |
|---|---|
| Purpose | Example. Exercises a scheduled run, a model call and a hand-off. |
| Department | ops |
| Schedule | Every 30 minutes (`0 */30 * * * *`, UTC on the server) |
| Model task | `hello.echo` → Claude Haiku 5.5, 1,024 max tokens, low effort |
| Code | [`src/workers/hello-world/hello-world.worker.ts`](../../src/workers/hello-world/hello-world.worker.ts) |

**What it does:** writes one upbeat sentence about "the start of a productive work session" (or
about `topic`, if you pass one with *Run now*), logs it, and hands the draft to Proof.

**Output:** a hand-off. It never creates a card itself, so its runs end as `ok`.

**Is it useful?** No. It's a heartbeat: if Echo's runs keep succeeding every 30 minutes, the
scheduler, queue, model key and cost logging are all working.

**Cost:** about 48 Haiku calls a day, roughly a cent a day.

## Proof (`hello-reviewer`)

| | |
|---|---|
| Purpose | Example. Exercises receiving a hand-off, a code check, and an approval card. |
| Department | quality |
| Schedule | None. Runs only when another worker hands it something (or *Run now*). |
| Model task | `hello.review` → Claude Haiku 5.5, 1,024 max tokens, low effort |
| Code | [`src/workers/hello-reviewer/hello-reviewer.worker.ts`](../../src/workers/hello-reviewer/hello-reviewer.worker.ts) |

**What it does:**

1. Reads the draft from the hand-off. With no draft it logs "nothing to review" and stops.
2. Checks the length in code (over 280 characters is flagged). This is rule 3: code decides what
   code can.
3. Asks the model for one sentence of feedback on tone.
4. Creates a **publish** card: *"Publish greeting to the dashboard?"* with the draft and feedback.

**When you approve the card:** `execute()` runs, but it only records "Published greeting (N
chars)". Nothing is actually published anywhere.

**Is it useful?** No. It's the template for any worker that reviews someone else's output and asks
you before acting.

**Side effect to know about:** because Echo runs every 30 minutes, Proof adds a card to *Needs you*
every 30 minutes (48 a day). Approving or rejecting them is harmless. If they get in the way, turn
Echo off (see [Managing workers](managing-workers.md)); Proof then goes quiet too.

## Jest (`joke-of-the-day`)

| | |
|---|---|
| Purpose | Real, just for fun. Posts a clean joke of the day you can tell your co-workers. |
| Department | culture |
| Schedule | Daily at 13:00 UTC (`0 0 13 * * *`): 8 AM US Eastern in winter, 9 AM in summer |
| Model task | `fun.joke` → Claude Haiku 5.5, 512 max tokens, low effort |
| Code | [`src/workers/joke-of-the-day/joke-of-the-day.worker.ts`](../../src/workers/joke-of-the-day/joke-of-the-day.worker.ts) |

**What it does:** picks a random topic in code (coffee, meetings, cats, space, and so on), asks
Haiku for one short, work-safe joke on it, and posts it to *Happening now* as "Jest shared today's
joke: …". The joke is also in the run's log on Jest's page.

**How it avoids repeats:** before each run it reads the last 30 jokes it posted from the event log
and tells the model not to repeat or rework them. Picking the topic in code keeps the jokes varied,
because a model left to choose tends to tell the same few jokes.

**Safety checks:** the prompt rules out profanity, innuendo, politics, religion and jokes about any
group of people. In code, an empty reply or one over 400 characters fails the run and isn't posted.

**Want one now, or on a theme?** Open Jest and click **Run now**. To pick the topic, pass
`{"topic": "pizza"}` as the input.

**Cost:** under $0.0002 per joke (the list of recent jokes is most of the input), about half a
cent a month.

**No approval card:** nothing leaves the dashboard, so there's nothing for you to approve.

## Demo workers (local dashboard only)

`npm run db:seed:demo` inserts these with fake runs and cards. They have **no code**
(`implemented = false`): the scheduler ignores them and *Run now* returns an error. They preview
the workers planned in the roadmap.

| Name | Slug | Department | Stands in for |
|---|---|---|---|
| Pulse | `demo-smoke` | release | Smoke test after each deploy |
| Probe | `demo-tests` | quality | Writing and repairing Playwright specs |
| Sorter | `demo-inbox` | inbox | Labelling inbound mail |
| Quill | `demo-drafts` | inbox | Drafting support replies |
| Lens | `demo-ga4` | analytics | Weekly GA4 report and anomaly flags |
| Vault | `demo-gtm` | analytics | Nightly GTM container backup |
| Herald | `demo-campaign` | marketing | Email campaign copy |
| Buzz | `demo-social` | social | Weekly batch of social posts |
| Critic | `demo-pr` | release | Pull request review |

Production was not seeded, so only Echo, Proof and Jest exist there.
