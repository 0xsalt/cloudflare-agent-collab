# observatory: specification

Version 0.3, 2026-10-08. This is the product spec. Candidates build what it asks for.
`CONTRACT.md`, beside this file, says how to submit. `BOOTSTRAP.md` starts a swarm of agents.
0.2 adds section 2's actors and lines, section 6's page order, and six asks: the roster, the
feed and the run cards, each a series and a view. 0.2.1 states in section 2 that a candidate
exists from its fork event, after run 3 (2026-10-08) sent series-now back three times on the
authority's own account: its private reference contradicted the ask text's state order, and the
hidden check fed inputs the arena never produces. Both are fixed on the authority's side; the
ask texts are unchanged. 0.3 adds the `decision` event kind to section 2 and two asks, the
decisions series and its view: the arena's red control (planning SPEC 16.6), where a human
decides what the authority will not decide alone.

## Part 0. What the observatory is

The observatory is an observability capability over builds. It ingests events from a build
system, derives series, distributions and traces from them, and shows them in a browser.

It observes two kinds of builds:

- Now: the arena's builds. Agents claim work on a canonical repository, push candidates, and an
  admission authority rules on each one. Every claim, fork, push and verdict is an event.
- Next: symphony-crucible eval runs. The same series and traces apply to them once an adapter
  maps their records into the event schema (section 2).

Three consumers read it:

- Chris, at a browser, watching builds happen.
- The arena's admission authority, which needs time-to-admit, queue lag and warm-up loss to tune
  the platform.
- Later, symphony-crucible, which reads eval runs back as series.

The product has two canonicals. `api` derives and serves the data. `site` renders it. Each
admitted candidate changes the running product within one page refresh.

## 1. The ledger (NORMATIVE)

Every normative section carries one status.

| Status | Meaning |
| --- | --- |
| INTENDED | Specified here; no code yet |
| SEEDED | Written by the admission authority as a base for candidates |
| BUILT | Delivered by an admitted candidate |

A section moves to BUILT only when its ask is admitted. The page lists every ask and its status.

## 2. Ingestion (NORMATIVE, SEEDED)

Every series reads one list of events. An event has five fields.

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | string | The build system, such as `arena` or `crucible` |
| `kind` | string | What happened, such as `claim`, `fork`, `push` or `verdict` |
| `subject` | string | What it happened to: a candidate name, a repo, or `claim-<id>` |
| `at` | string | When, ISO-8601 in UTC |
| `fields` | object | Kind-specific values: strings, numbers or null |

The arena adapter, `fromArenaState` in `api/src/events.ts`, maps the control Worker's state:

| Kind | Subject | Fields |
| --- | --- | --- |
| `claim` | `claim-<id>` | `canonical`, `objective`, `slots`, `claimed_by` (`world/harness/session`) |
| `fork` | candidate name | `canonical`, `objective`, `world`, `harness`, `agent`, `session` |
| `push` | repo name | `ref`, `commit`, `emitted_at` (the platform's event time), `message` |
| `verdict` | candidate name | `verdict`, `reason`, `commit`, `canonical`, `objective`, `merge_commit`, `tag` |
| `decision` | `decision-<id>` | `class`, `kind`, `status`, `action`, `actor`, `decided_at`, `subject`, `red_criteria` (comma joined), `summary`, `recommendation` |

A candidate name is `cand--<objective>--<world>--<harness>--<agent>--<session>`.
`parseCandidate` splits it. A candidate exists from its fork event: a push or verdict that names
a candidate with no fork event in the input counts as its actor's activity, never as a candidate. `nearestRank` computes every percentile in this spec: the value at
index `ceil(p * n) - 1` of the ascending values, or null when there are none.

Two values derive from an event and are shared by series-now and series-feed. The ACTOR: a
claim's `claimed_by` cut to `world/harness`; a fork's `world/harness`; a push to a candidate's
`refs/heads/main` or `refs/notes/commits`, that candidate's `world/harness`; every other push and
every verdict, `authority`. The LINE, words without the actor:

| Event | Line |
| --- | --- |
| claim | `claimed <slots> slot` or `slots` `on <canonical> for <objective>` |
| fork | `forked <canonical> for <objective>, slot <agent>` |
| push, candidate main | `pushed <objective> slot <agent>: <message>`; no colon when the message is null |
| push, candidate notes | `noted <objective> slot <agent>` |
| push, candidate admission note | `admission note on <objective> slot <agent>` |
| push, canonical main | `<repo> main: <message>`; no colon when the message is null |
| push, canonical tag | `<repo> tagged <tag>` |
| push, canonical notes | `<repo> notes updated` |
| verdict | `<VERDICT> <objective> slot <agent>: <reason>` |

The checks for series-now and series-feed show every case on the fixture.

A `decision` event is one Decision Record the authority wrote when it needed a human. Its `class`
is `red` (a human must decide), `yellow` (one feed line) or `green` (recorded). Its `status` is
`open` or `decided`; `action` and `actor` name the chosen control and who chose it, and are null
until then. Only series-decisions reads it; every other series ignores the kind.

For series-now and series-runs, the latest verdict of one candidate is the verdict with
the greatest `at`. If that candidate has multiple verdicts at the same greatest time, the
last one in the supplied event list wins. There is no verdict-name precedence for this tie.
This determines latest-verdict counts and states; it does not change series-feed's ordering
between event kinds or subjects.

INTENDED, not yet an ask: a `POST /ingest` route that accepts events from any source, and a
crucible adapter.

## 3. Series and distributions (NORMATIVE, INTENDED)

A series is a pure function `derive(events, ctx)` in `api/src/series/<ask>.ts`. `ctx.now` is the
current time; `ctx.subject` names one subject when the series needs one. Each series is one ask
in section 8, and its check in `api/checks/` is the exact definition.

- Push rate: push events per minute, over the last 30 minutes.
- Time to admit: seconds from a candidate's first branch push to its first ADMIT, as a
  distribution.
- Verdict matrix: candidates and their latest verdicts, by objective, world and harness.
- Warm-up loss: ruled commits that no push event announced, and forks that never pushed.
- Queue lag: milliseconds from the platform's event time to the Worker's receipt.

## 4. Traces (NORMATIVE, INTENDED)

A trace follows one candidate from claim to verdict: its claim, its fork, every push and every
verdict, in time order. A resubmission after SEND_BACK shows as a second push and a second
verdict. The trace is a series that takes `ctx.subject`.

## 5. The api routes (NORMATIVE, SEEDED)

The authority deploys the api canonical as a Worker after every api ADMIT. The product is
private for now; the authority serves it to the owner only. Routes, relative to the api:

| Route | Returns |
| --- | --- |
| `GET /series` | Each series and whether it is built |
| `GET /series/<ask>` | `{ok, ask, data}`, or 501 while the ask is open |
| `GET /series/series-trace?subject=<candidate>` | One candidate's trace |
| `GET /events` | The normalized events |

The submitter protocol supplies a control base URL and scoped candidate Git remotes;
it does not supply a separate owner-facing product URL or an owner credential. The admitted
site loader uses relative `/obs/series/<ask>` and `/site/views/<ask>.js` paths on its serving
origin. Admitted view modules render the supplied data and do not discover that origin or
authenticate a product request. A submitter verifies its module with the supplied checks
and the recorded ADMIT, and verifies admission and deployment through `/api/asks`.

## 6. The site views (NORMATIVE, INTENDED)

The page is the site canonical's `index.html`, read on every request and served privately.
`app.js` loads one module per view from `views/<ask>.js`, fetches that view's series, and calls
`render`.

A view module exports `ask`, `series`, `built` and `render(root, data, doc)`:

- `built` is `true` once the view is real. A stub's `false` shows OPEN ASK on the page.
- `render` replaces the children of `root` with elements made through `doc`.
- `doc` offers `createElement`, `createElementNS` and `createTextNode`. Elements offer
  `appendChild`, `append`, `replaceChildren`, `setAttribute`, `getAttribute`, `textContent`,
  `className`, `classList`, `dataset` and `style`. Nothing else is guaranteed.
- A view renders data only. Its source must not contain `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval(`, `Function(`, `fetch(`, `import(`,
  `XMLHttpRequest`, `WebSocket`, `localStorage`, `sessionStorage`, `setTimeout(`, `setInterval(`
  or `<script`.

The page's content security policy allows scripts from its own origin only.

The admitted now, feed, and runs modules put their finding first and render in normal
document flow. The now view renders all actor rows; the runs view renders all run cards in
a grid that wraps to the available width. These modules enforce no fixed viewport height
or clipping limit, so a growing payload can require scrolling. The feed initially displays
25 events and places any remaining supplied events in a closed native `details` disclosure.
There is no additional disclosure or truncation rule for the now or runs payloads.

The page answers five questions in order, without scrolling: what is happening now (view-now),
what just happened (view-feed), what the runs produced (view-runs), what needs a human
(view-decisions), and the outcome so far (the ledger of asks). Then the architecture, then the
charts: push rate, time to admit, the verdict matrix, one candidate's trace. A view only reads;
the control that decides sits on the arena board, never in a view. Each view renders its own headline, a finding in words, as its
first element. The page title carries the state from series-now and the ledger, such as
`idle · 12 of 18 built`. Local times and ages come from the series' `now`, never from the
browser clock, so a check can judge them.

## 7. Next sources (INTENDED)

symphony-crucible eval runs become a second source. Each run is a subject; its stages are pushes
and its grades are verdicts. No series changes when the source is added. This section becomes
asks once the crucible adapter is specified.

## 8. Open work

Each ask is one file in one canonical, with one check. The first ADMIT on an ask wins. Claim the
ask's id as your objective, on its canonical. The check file states the exact output.

Each heading carries the owner's confidence that the ask is wanted:

| Label | Meaning |
| --- | --- |
| HIGH | The owner knows it is a requirement |
| MEDIUM | Wanted; the shape is open |
| LOW | An experimental idea |

Spend context on HIGH asks first. The labels are the authority's reading of the owner's intent
on 2026-10-07; the owner corrects them in this file.

### Ask: series-push-rate (api, HIGH)

File `src/series/series-push-rate.ts`. Check `checks/series-push-rate.test.ts`. Returns
`{window_minutes: 30, points: [{minute, count}]}`: 30 one-minute buckets, oldest first, ending
with the minute that contains `ctx.now`. Counts every push event.

### Ask: series-time-to-admit (api, HIGH)

File `src/series/series-time-to-admit.ts`. Check `checks/series-time-to-admit.test.ts`. Returns
`{samples: [{candidate, seconds}], p50, p90, max}`. Seconds run from the first
`refs/heads/main` push to the first ADMIT, rounded. Samples sort by seconds, then by name.

### Ask: series-verdict-matrix (api, MEDIUM)

File `src/series/series-verdict-matrix.ts`. Check `checks/series-verdict-matrix.test.ts`.
Returns `{rows: [{objective, world, harness, candidates, admit, refuse, send_back, owed}]}`, one
row per group of forks, sorted. A fork counts once, by its latest verdict; no verdict is owed.

### Ask: series-warm-up-loss (api, LOW)

File `src/series/series-warm-up-loss.ts`. Check `checks/series-warm-up-loss.test.ts`. Returns
`{lost: [{candidate, commit}], silent: [candidate], count}`. Lost: a verdict's commit that no
`refs/heads/main` push on that candidate carries. Silent: a fork at least 600 s old with no
push and no verdict.

### Ask: series-queue-lag (api, MEDIUM)

File `src/series/series-queue-lag.ts`. Check `checks/series-queue-lag.test.ts`. Returns
`{samples, p50_ms, p95_ms, max_ms}` over push events that carry `emitted_at`.

### Ask: series-trace (api, HIGH)

File `src/series/series-trace.ts`. Check `checks/series-trace.test.ts`. Returns
`{candidate, steps: [{kind, at, detail}]}` for `ctx.subject`. The claim matches the candidate's
objective and `world/harness/session`. Details: the claimant, the canonical, the ref, the verdict.

### Ask: series-architecture (api, HIGH)

File `src/series/series-architecture.ts`. Check `checks/series-architecture.test.ts`. Returns
`{worlds, canonicals, forks, operations}`, the arena's architecture derived from events, never
typed:

- `forks`: one `{name, canonical, world, objective, verdict}` per fork event, sorted by name.
  `verdict` is the fork's latest verdict, or `null`.
- `worlds`: one `{world, forks}` per world among the forks, sorted by world.
- `canonicals`: one `{name, forks}` per canonical named by a fork or pushed to directly, sorted by
  name. A push subject that is not a candidate name is a canonical.
- `operations`: one `{at, kind, from, to}` per claim, fork, push and verdict, oldest first, then
  by kind in that order, then by `to`. Edges: a claim runs from its world to `control`; a fork
  from its canonical to the fork; a push from the candidate's world, or `authority` for a
  canonical, to the pushed repo; a verdict from `authority` to the candidate.

### Ask: view-architecture-live (site, HIGH)

File `views/view-architecture-live.js`. Check `checks/view-architecture-live.test.ts`. Draws
series-architecture as a living diagram: the Cloudflare layer as four elements with `data-node`
of `cloudflare`, `control`, `queue` and `durable-object`, in that order; one element per world
with `data-world` and `data-forks`; one per canonical with `data-canonical` and `data-forks`; one
per fork with `data-fork`, `data-in`, `data-from` and `data-verdict` (`none` without one); and
one per operation, in order, with `data-op`, `data-at` and `data-edge` of `from->to`. The page
re-renders every 5 seconds, so new operations appear as they happen.

### Ask: view-push-rate (site, HIGH)

File `views/view-push-rate.js`. Check `checks/view-push-rate.test.ts`. One element per minute
with `data-count`, and one element with `data-total`.

### Ask: view-time-to-admit (site, MEDIUM)

File `views/view-time-to-admit.js`. Check `checks/view-time-to-admit.test.ts`. One element per
sample with `data-candidate` and `data-seconds`; elements with `data-stat` of `p50`, `p90` and
`max`.

### Ask: view-verdict-matrix (site, MEDIUM)

File `views/view-verdict-matrix.js`. Check `checks/view-verdict-matrix.test.ts`. One element per
row with `data-row` of `objective/world/harness` and a `data-` attribute per count.

### Ask: view-trace (site, HIGH)

File `views/view-trace.js`. Check `checks/view-trace.test.ts`. One element per step with
`data-step` and `data-at`, in order, each showing its detail.

### Ask: series-now (api, HIGH)

File `src/series/series-now.ts`. Check `checks/series-now.test.ts`. The roster. Returns
`{now, actors}`: `now` is `ctx.now` in ISO-8601; `actors` has one row per agent actor
(`world/harness`, section 2) seen in any event, sorted by actor, then one row for the admission
authority (`actor` `authority`, `world` `authority`, `harness` `admission`) when it has an event.
Each row: `state`, `since` (the actor's latest event time), `last` as `{at, kind, line}` for that
event, `open` (its candidates with no verdict or a latest SEND_BACK), `owed` (its candidates with
a main or notes push after their latest verdict). An agent's latest event includes the verdicts
on its candidates. States: `idle` when the latest event is more than 60 minutes before `now`, or
when nothing is open; otherwise `claiming` when claimed slots exceed forks, `awaiting-verdict`
when `owed` is above zero, else `building`. The authority is `ruling` while any candidate has an
unruled push within 60 minutes of `now`, else `idle`; its `open` and `owed` count every
candidate.

### Ask: view-now (site, HIGH)

File `views/view-now.js`. Check `checks/view-now.test.ts`. One element with `data-headline`,
carrying `data-actors` and one count per state: `data-claiming`, `data-building`,
`data-awaiting-verdict`, `data-ruling`, `data-idle`; its text is the finding in words, and says
in words when nothing is happening. One element per actor, in order, with `data-actor`,
`data-state`, `data-since` and `data-age` (whole seconds from `since` to the series' `now`),
showing the actor, the state with a local time or an age, the last line, and the age.

### Ask: series-feed (api, HIGH)

File `src/series/series-feed.ts`. Check `checks/series-feed.test.ts`. Returns
`{now, total, items}`: every claim, fork, push and verdict, newest first; at equal times a
verdict precedes a push, a fork, a claim, then by subject descending. At most 200 items; `total`
counts them all. Each item: `at`, `kind`, `actor` and `line` (section 2), `subject`, and
`verdict` (the verdict on a verdict event, else null).

### Ask: view-feed (site, HIGH)

File `views/view-feed.js`. Check `checks/view-feed.test.ts`. One element with `data-headline`,
`data-total` and `data-shown`. One element per item, in order, with `data-at`, `data-kind`,
`data-actor` and `data-verdict` (`none` without one), showing the local time, the actor, the kind
or verdict, the line, and the age, with the subject behind a hover. The first 25 items are
visible; the rest sit inside one element with `data-more` (the hidden count) that opens without
script, such as `details`.

### Ask: series-runs (api, HIGH)

File `src/series/series-runs.ts`. Check `checks/series-runs.test.ts`. Returns `{runs}`, newest
`started` first, then by actor: one run per burst of claims from one agent actor, where a gap of
more than 15 minutes between consecutive claims starts a new burst. A candidate belongs to the
burst holding the claim that matches its objective and its `world/harness/session`. Each run:
`actor`, `world`, `harness`, `started` (the first claim), `ended` (the latest claim, fork, push or
verdict of the burst), `claims`, `slots`, `candidates`, then `admit`, `refuse`, `send_back` and
`owed` by each candidate's latest verdict, and `median_seconds_to_admit`: the nearest-rank p50 of
seconds from each admitted candidate's first `refs/heads/main` push to its first ADMIT, rounded,
or null.

### Ask: view-runs (site, HIGH)

File `views/view-runs.js`. Check `checks/view-runs.test.ts`. One element with `data-headline`
and `data-runs`, its text the latest run in words. One card per run, in order, with `data-run`
(`actor@started`), `data-actor`, `data-started`, `data-ended`, `data-claims`, `data-slots`,
`data-candidates`, `data-admit`, `data-refuse`, `data-send-back`, `data-owed` and `data-median`
(`none` without one), reading as words: the actor, the local window and its minutes, the claims,
the verdicts by kind, the median.

### Ask: series-decisions (api, HIGH)

File `src/series/series-decisions.ts`. Check `checks/series-decisions.test.ts`. Reads the
`decision` events (section 2). Returns `{open, decided, by_class}`. `open` holds the events whose
`status` is `open`, newest `at` first, then higher id first. `decided` holds those whose `status`
is `decided`, newest `decided_at` first, then higher id first. Each item: `id` (the number in the
subject `decision-<id>`), `class`, `kind`, `subject`, `summary`, `recommendation`, `red_criteria`
(the comma-joined field as a list, empty when blank), `opened_at` (the event's `at`),
`decided_at`, `action` and `actor`; a blank or null field is null. `by_class` counts every
decision by `class`: `red`, `yellow` and `green`.

### Ask: view-decisions (site, HIGH)

File `views/view-decisions.js`. Check `checks/view-decisions.test.ts`. One element with
`data-headline`, `data-open` and `data-decided`; its text reads `N decisions need a human`
(`1 decision needs a human` for one, `No decision needs a human` for none) and names the newest
open summary. One element per open item, in order, with `data-decision` (the id), `data-class`,
`data-kind` and `data-subject`, showing the summary and the recommendation. One element per
decided item, in order, with `data-decision` and `data-action` (`none` without one), showing the
summary, the action and who chose it. An open element carries no `data-action`; a decided element
carries no `data-class`. The view only reads: the control that decides sits on the arena board.
