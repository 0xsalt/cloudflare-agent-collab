# Cost estimate

This document records the measured Cloudflare Artifacts usage of the proof of concept and projects
the cost of larger runs. Artifacts billing starts on 2026-10-14, so the proof-of-concept usage on
2026-10-06 was not billed.

## Pricing used

Source: the Artifacts pricing page, last updated 2026-10-01. Artifacts requires the Workers Paid
plan ($5 per month).

| Unit | Included per month | Overage |
| --- | --- | --- |
| Operations | 10,000 | $0.15 per 1,000 |
| Storage | 1 GB-month | $0.50 per GB-month |

## Measured usage

Operations come from the GraphQL Analytics dataset `artifactsEventsAdaptiveGroups`, filtered to
the `agent-collab-poc` namespace, 02:00 to 06:00 UTC on 2026-10-06, queried at 03:13 UTC.

| Event type | Count | p50 duration | p95 duration |
| --- | ---: | ---: | ---: |
| token_create | 41 | 0 ms | 0 ms |
| pull (clone or fetch) | 41 | 200 ms | 273 ms |
| push | 34 | 180 ms | 275 ms |
| read (binding metadata or log) | 6 | 75 ms | 108 ms |
| fork | 5 | 0 ms | 0 ms |
| namespace_get | 2 | 39 ms | 292 ms |
| namespace_create | 1 | 0 ms | 0 ms |
| create | 1 | 0 ms | 0 ms |
| Total | 131 | | |

Notes on the measurement:

- The dataset lagged the run. The run made 36 pushes and 6 forks; the query returned 34 and 5.
- `token_create`, `read`, `namespace_get` and `namespace_create` appear in the data but not in the
  documented event-type list. Count them as billable until Cloudflare says otherwise.
- Two requests refused with HTTP 403 (a token used on the wrong fork) did not appear as
  `clientError`.

Storage: the dataset `artifactsStorageAdaptiveGroups` (field `max.repositorySizeBytes`) exists in
the GraphQL schema but returned no rows for this account. As a fallback, a mirror clone of each of
the 6 repositories holds 23,356 bytes of git objects in total. That is the client-side pack size,
not the stored size, and it cannot show whether forks share objects on the server.

## Proof-of-concept cost

131 operations and about 23 KB are inside the included 10,000 operations and 1 GB. The
proof-of-concept cost is $0 beyond the Workers Paid plan.

## Projection

One agent task, as the proof of concept ran it, costs 3 Artifacts operations: mint a token, clone,
push. A task that also creates its own fork costs 4. Merging a fork back into the canonical repo is
not built yet; assume 2 more operations (fetch and push) for it, so 6 per task.

| Scenario | Tasks per month | Operations | Artifacts operations cost |
| --- | ---: | ---: | ---: |
| Contest demo: 10 agents, 20 tasks per day, 8 days | 1,600 | 9,600 | $0.00 |
| Small team: 50 agents, 50 tasks per day, 30 days | 75,000 | 450,000 | $66.00 |
| Large: 1,000 agents, 50 tasks per day, 30 days | 1,500,000 | 9,000,000 | $1,348.50 |

Storage stays small for source code: 1,000 forks of a 5 MB repository is 5 GB if forks share
nothing, which is $2.00 per month. Whether forks share objects is UNCERTAIN.

Other services are minor at these sizes. Each push event is one Queue message (3 Queue operations
with 1,000,000 included per month). The Durable Object handles one request per claim and per event
batch.
