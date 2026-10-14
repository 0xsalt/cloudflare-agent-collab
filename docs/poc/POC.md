# Proof-of-concept results

The proof of concept asked one question: does the Cloudflare substrate do what a multi-agent code
platform needs? The answer is GO. All six attempted criteria passed on 2026-10-06 (UTC); the
project owner cancelled criterion 5. Push events need one workaround, described under "Push-event
warm-up". Storage came from a fallback measurement, described under criterion 7.

The evidence below was collected with the Worker at commit `02740b8`. A later commit hardens the
Queue consumer (per-message ack, duplicate drop) and validates input; it is not deployed yet.

Times are UTC. Account ids, tokens and resource ids are redacted from all output below.

All proof-of-concept resources were deleted on 2026-10-06 at 03:26 UTC: the Worker, its Durable
Object, the Queue, 7 event subscriptions, 7 repos and the Artifacts namespace. The workers.dev URL
below now returns 404.

## Results

| # | Criterion | Result |
| --- | --- | --- |
| 1 | The Worker creates a canonical repo and forks it 3 times | PASS |
| 2 | The Worker mints a repo-scoped write token per fork | PASS |
| 3 | Three agents clone their forks and push distinct commits concurrently | PASS |
| 4 | Push events reach the Worker through a Queue and are recorded | PASS, with a warm-up workaround |
| 5 | 200 simulated agents claiming 50 items | CANCELLED: not requested by the project owner |
| 6 | One workers.dev page shows objective, forks, commits and claims live | PASS |
| 7 | Artifacts operations and storage read from metrics; cost written down | PASS for operations, fallback for storage |

## 1. Canonical repo and forks

`POST /api/canonical` created `canonical` through the Artifacts binding. A seed commit
(`f8d9a7f`) was pushed to it over plain git. `POST /api/forks` with agents `a1`, `a2`, `a3`
returned:

```json
{"ok":true,"forks":[
  {"ok":true,"agent":"a1","name":"fork-a1","remote":"https://<ACCT>.artifacts.cloudflare.net/git/agent-collab-poc/fork-a1.git"},
  {"ok":true,"agent":"a2","name":"fork-a2","remote":"https://<ACCT>.artifacts.cloudflare.net/git/agent-collab-poc/fork-a2.git"},
  {"ok":true,"agent":"a3","name":"fork-a3","remote":"https://<ACCT>.artifacts.cloudflare.net/git/agent-collab-poc/fork-a3.git"}]}
```

Three more forks (`fork-probe`, `fork-warm1`, `fork-pre1`) were created later for the event tests.
`GET /api/repos` lists 7 repositories, all with status `ready`.

## 2. Repo-scoped tokens

`POST /api/repos/<repo>/token` mints a write token with a one-hour lifetime. A token minted for
`fork-a1` was then used against `fork-a2`:

```text
ls-remote own fork-a1 exit=0: cf5afc20a7bbb8a58e10b3c96a528c614f86dbee refs/heads/main
ls-remote fork-a2 with fork-a1 token exit=128: remote: Invalid or expired token
  The requested URL returned error: 403
push to fork-a2 with fork-a1 token exit=128: remote: Invalid or expired token
  The requested URL returned error: 403
```

The token reads and writes its own fork and is refused, for both read and write, on a sibling.

## 3. Concurrent pushes

`bun scripts/poc.ts agents a1 a2 a3` runs three agents at once. Each one claims a work item,
mints a token, clones its fork, commits a distinct file, and pushes. First run, started 03:00:54:

| Agent | New head | Push exit | Push started after | Total |
| --- | --- | ---: | ---: | ---: |
| a1 | `cf5afc2` | 0 | 1,707 ms | 2,249 ms |
| a2 | `c494b02` | 0 | 1,345 ms | 2,024 ms |
| a3 | `0458e67` | 0 | 1,378 ms | 2,068 ms |

All three pushes went from the shared seed `f8d9a7f` to distinct heads inside the same second.
Across all runs, 36 of 36 pushes succeeded.

## 4. Push events through the Queue

Each fork has a repository-level event subscription (source `artifacts.repo`, event `pushed`) that
delivers to the `agent-collab-events` Queue. The Worker consumes the Queue and writes each event to
the Coordinator Durable Object.

After warm-up, delivery was complete:

- Run 2, 3 concurrent pushes: 3 of 3 delivered. `verify` matched the live Artifacts head with the
  recorded event on every fork.
- Five more rounds, 15 concurrent pushes: 15 of 15 delivered.
- Push-to-record latency over 19 events (one solo push, run 2 and the five rounds), in whole
  seconds: 0 s (4 events), 1 s (10), 2 s (4), 4 s (1).

The event log also holds one synthetic message (repo `synthetic-test`). It was sent straight to
the Queue to prove the consumer path while real events were missing.

### Push-event warm-up

A new subscription drops events for its first ~50 seconds. They are lost, not late.

- The first run's 3 pushes came 7 seconds after their subscriptions were created. None arrived.
  The Queue backlog was 0, so the consumer was not at fault.
- `fork-warm1`: subscription created at 03:08:09, then one push every ~5 seconds. Pushes at +2 s
  through +48 s were lost (10 of 10). Pushes at +53 s and +58 s were delivered (2 of 2). A
  recheck 3 minutes later still showed 2 of 12.
- `fork-pre1`: the subscription was created before the repo existed, which the API accepts. After
  70 seconds the repo was forked and pushed 2 seconds later. The push was delivered (1 of 1).

The workaround: create the push subscription first and hand out the fork after the warm-up. A
platform can keep a pool of pre-subscribed fork names ready. The `fork-pre1` result is a single
sample.

## 5. Claims burst

Cancelled. The project owner did not ask for a simulated-agent load test. The Durable Object still
holds work claims for the real agents: each agent claims `item-<agent>` before it pushes. Inserts
use `ON CONFLICT DO NOTHING`, and a Durable Object runs one request at a time.

## 6. Live page

The control Worker's workers.dev page polls `/api/state` every 2 seconds. The
headless-browser check passed with no console errors and no failed requests. The screenshot shows
the objective, 5 forks, 22 push events, 4 claims and the commit table:
[evidence/poc-page.png](evidence/poc-page.png).

## 7. Metrics and cost

Artifacts operation counts came from the GraphQL dataset `artifactsEventsAdaptiveGroups`: 131
operations in total. The storage dataset returned no rows, so storage was measured from mirror
clones: about 23 KB. The figures and projections are in [COST.md](COST.md).

## Other surprises

- Account-level lifecycle events never arrived. The `artifacts` source subscription for
  `repo.created` and `repo.forked` delivered 0 events for the 3 forks made 5 to 12 minutes after
  it was created.
- `wrangler queues subscription create` (4.147.0) has no flags for the `artifacts.repo` source's
  namespace and repo name. The REST API accepts `source.namespace` and `source.repo_name`.
- Repo tokens use the prefix `art_v2_`. The git-protocol docs describe `art_v1_`.
- `last_push_at` stays `null` on repo metadata after successful pushes.
- The Artifacts binding needs wrangler 4.145.0 or later.
- The GraphQL data shows event types missing from the docs: `token_create`, `read`,
  `namespace_get`, `namespace_create`.

## Reproduce

The resources were torn down on 2026-10-06. The POC Worker grew into `src/index.ts`, and
[README.md](../../README.md) installs the current arena.
