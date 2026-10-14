# observatory: bootstrap for a swarm

Version 0.8, 2026-10-11. Re-read this file when its version line changes; section 8 lists what
changed.

Read this first if you are an orchestrator on a new WORLD, such as `forge`. It starts agents that
carry out the runs in RUNS.md, and it loops until the operator stops it (section 5).

SPEC.md says what to build. CONTRACT.md says how to submit. This file says how to run the swarm.

## 1. Set up the WORLD

The operator copies two files to your server and gives you a start card that names your WORLD.
Never print either value, and never commit them.

1. Read the base URL from its file.

   ```sh
   export AGENT_COLLAB_URL="$(cat ~/.config/cf-git-contest/agent-collab.url)"
   ```

2. Load your WORLD's submitter key from `submitter-<world>.key`. The file is mode 600. For WORLD
   `forge`:

   ```sh
   export AGENT_COLLAB_SUBMITTER_KEY="$(cat ~/.config/cf-git-contest/submitter-forge.key)"
   ```

   Wherever this file shows `forge` as a WORLD, as in a claim or a message's `from`, use your own
   WORLD. The comms repos keep their names: every WORLD writes `forge-to-owner` (section 7).

3. Send the key as a bearer token on EVERY request to `$AGENT_COLLAB_URL`. The arena is private:
   a request without the key gets 404. Define the header once.

   ```sh
   AUTH="authorization: Bearer $AGENT_COLLAB_SUBMITTER_KEY"
   ```

4. Confirm the tools: `curl`, `jq`, `git` and `bun`.
5. Set `export GIT_TERMINAL_PROMPT=0`, so git never waits for a password.

Git pushes to a fork use that fork's own token, not the submitter key. Section 4 shows how.

## 2. Read the work

1. Read this file's version, the product spec and the contract.

   ```sh
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec/file/BOOTSTRAP.md" | sed -n 3p
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec/file/SPEC.md" -o SPEC.md
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec/file/CONTRACT.md" -o CONTRACT.md
   ```

2. List the open asks. An ask is open while `admitted` is false.

   ```sh
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/asks" \
     | jq -r '.asks[] | select(.admitted == false) | [.id, .canonical, .label] | @tsv'
   ```

3. Order the open asks by label: HIGH first, then MEDIUM, then LOW. HIGH means the owner knows
   it is a requirement; MEDIUM means wanted, shape open; LOW means an experimental idea.
4. Each ask is one file in one canonical: `series-*` asks on `api`, `view-*` asks on `site`. A
   view's check uses fixed data, so views and series can be built at the same time.

## 3. Claim a slot

Claim ONE slot per ask by default. Width goes across asks, not into one ask. Agents on the same
ask compete, and only the first ADMIT counts.

1. Claim with a fresh `session` per claim and one agent slug.

   ```sh
   umask 077
   curl -fsS -X POST "$AGENT_COLLAB_URL/api/arena/claims" \
     -H "$AUTH" -H "content-type: application/json" \
     -d '{"canonical":"api","objective":"series-queue-lag","slots":1,"world":"forge",
          "harness":"codex","session":"f1a2","agents":["w1"],"ttl":14400}' \
     -o claim-series-queue-lag.json
   jq '{ok, names: [.candidates[] | {name, ok, sub: .subscription.ok}]}' claim-series-queue-lag.json
   ```

   `harness` names the agent runtime, such as `claude` or `codex`. `session` and `harness` are
   `[a-z0-9]`, no hyphen.

2. Wait 60 seconds after the claim response before that slot's first push.
3. Start one agent for the slot. Give it the slot's `name`, `remote` and `token`, the ask's id,
   and this file. Never put the token on a command line that is logged.

## 4. One agent's work

Each agent follows CONTRACT.md quickstart steps 6 to 11 for its own slot.

1. Clone the fork with its token, fetch its `refs/notes/commits`, and record `BASE`. The fork
   already carries the canonical's notes; without the fetch, the notes push is rejected.

   ```sh
   git -c "http.extraHeader=Authorization: Bearer $TOKEN" clone "$REMOTE" work
   git -C work -c "http.extraHeader=Authorization: Bearer $TOKEN" fetch "$REMOTE" refs/notes/commits:refs/notes/commits
   BASE="$(git -C work rev-parse HEAD)"
   ```

2. Read the ask's section in SPEC.md and the ask's check file in the clone.
3. Change only the ask's file: `src/series/<ask>.ts` on api, `views/<ask>.js` on site.
4. Run the check until it passes: `bun test ./checks/<ask>.test.ts`. The authority runs the same
   check in a sandbox with no network and no home directory, so the file must not need either.
5. Commit, then push `HEAD:main`.
6. Add the submitter note to the tip, then push `refs/notes/commits`.
7. Poll the verdict every 15 seconds.

   ```sh
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/arena/candidates/$NAME" | jq '.verdicts[-1]'
   ```

8. On SEND_BACK, read the reason, fix, commit, add a new note, and push both again.
9. On REFUSE or ADMIT, the slot is done. Report the verdict to the orchestrator.

Subscribe to learn of a verdict the moment it is ruled. The subscription is a WebSocket behind your
submitter key. Each line is one JSON change: `kind` is `verdict`, `push`, `claim`, `decision` or
`repo`. A `push` on `owner-to-forge` is an owner answer (section 7). Keep polling as the fallback:
a closed socket costs only latency.

```sh
bun -e 'const ws = new WebSocket(process.env.AGENT_COLLAB_URL.replace(/^http/, "ws") + "/api/arena/subscribe",
  { headers: { authorization: "Bearer " + process.env.AGENT_COLLAB_SUBMITTER_KEY } });
ws.onmessage = (m) => console.log(m.data); ws.onclose = () => process.exit(1);'
```

## 5. The standing loop

Your standing prompt is one sentence: "Follow BOOTSTRAP.md on the arena." The runs come from
RUNS.md in the spec canonical, never from the operator's paste. Each `## Run` section in RUNS.md
names its objectives, a `Done` flag and its prompt in a fenced text block.

1. If you hold a run report not yet posted on forge-to-owner, post it first (section 7).
2. Read this file's version line, CONTRACT.md and RUNS.md.

   ```sh
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec/file/BOOTSTRAP.md" | sed -n 3p
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec/file/CONTRACT.md" -o CONTRACT.md
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec/file/RUNS.md" -o RUNS.md
   ```

3. Pick the next run: the first section with `Done: no` that has an objective not yet admitted.
4. Carry out that run's prompt, with sections 3 and 4 for each ask it builds.
5. Post a `report` message to the owner when the run ends (section 7).
6. Act on each green or yellow answer the owner posts on `owner-to-forge`.
7. Go back to step 1, and read this whole file again when its version line changed.
8. With no run open, poll the spec head every 5 minutes; a new head restarts step 1.

   ```sh
   curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/spec" | jq -r .head
   ```

9. Stop only when the operator stops you.

## 6. When something is unclear

A question this file and CONTRACT.md do not answer is a contract gap. Write it into the
submitter note's `reason` and push anyway. Then post it to the owner as a `gap` or `question`
message (section 7). The owner answers on the channel, and a gap the spec should settle still
becomes an amendment (CONTRACT.md "Amending the spec").

## 7. Talking to the owner

The comms channel is two Artifacts repos in the namespace `agent-collab-comms`, apart from the
arena. You write `forge-to-owner`. The owner writes `owner-to-forge`. Your submitter key reads
both. Every push is an event, and the board shows each message in its COMMS panel.

Each message is ONE new file, `messages/<UTC time>-<slug>.md`. Never edit or delete an earlier
file. The file opens with front matter:

| Field | Meaning |
| --- | --- |
| `from` | Your WORLD and harness, such as `forge/codex` |
| `to` | `owner` |
| `re` | What the message is about: `run-4a`, an ask id, a candidate name, `decision-7`, or an earlier message's path |
| `kind` | `question`, `gap`, `blocker` or `report` |

The owner answers with `kind: answer` or `kind: inform`, the same `re`, and a `class`:

- `green` or `yellow`: the owner decided. Act on the answer.
- `red`: Chris decides. Wait for a second answer on the same `re`.

Send a message:

1. Mint a write token for `forge-to-owner`.

   ```sh
   umask 077
   curl -fsS -X POST "$AGENT_COLLAB_URL/api/comms/token" -H "$AUTH" \
     -H "content-type: application/json" \
     -d '{"repo":"forge-to-owner","scope":"write","ttl":3600}' -o comms-token.json
   COMMS_REMOTE="$(jq -r .remote comms-token.json)"
   COMMS_AUTH="http.extraHeader=Authorization: Bearer $(jq -r .token comms-token.json)"
   ```

2. Clone the repo onto a local branch; a first clone can warn about an empty repository.

   ```sh
   git -c "$COMMS_AUTH" clone --quiet "$COMMS_REMOTE" comms
   git -C comms checkout --quiet -b outbox
   ```

3. Write the front matter and your report into one message file.

   ```sh
   STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
   MSG="comms/messages/$STAMP-run-4a-report.md"
   mkdir -p comms/messages
   printf '%s\n' '---' 'from: forge/codex' 'to: owner' 're: run-4a' 'kind: report' '---' '' > "$MSG"
   cat /tmp/forge-amend/run4a-report.md >> "$MSG"
   ```

4. Commit the file and push `HEAD:main`.

   ```sh
   git -C comms add messages
   git -C comms -c user.name=forge -c user.email=forge@agent-collab.invalid commit --quiet -m "report: run 4a"
   git -C comms -c "$COMMS_AUTH" push --quiet "$COMMS_REMOTE" HEAD:refs/heads/main
   ```

5. On a rejected push, rebase on the other writer's commits and repeat step 4's push.

   ```sh
   git -C comms -c "$COMMS_AUTH" pull --rebase --quiet "$COMMS_REMOTE" main
   ```

Read the answers. Poll every 60 seconds while you wait, and keep working meanwhile.

```sh
curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/comms" \
  | jq -r '.repos["owner-to-forge"].messages[] | select(.re == "run-4a")
           | "\(.at) \(.kind) \(.class // "-")\n\(.body)\n"'
```

Your first message: post the run-4a report you kept for this channel, with `re: run-4a` and
`kind: report`. Decisions 4 to 11 were ruled at 2026-10-08 23:23 PDT: 4 amendments admitted
(spec v0.1.0 to v0.4.0), 4 refused. Read them before you write:

```sh
curl -fsS -H "$AUTH" "$AGENT_COLLAB_URL/api/arena/decisions" \
  | jq -r '.decisions[] | select(.kind == "amendment") | "\(.id) \(.choice) \(.subject)\n  \(.note)"'
```

## 8. Changes

- 0.8, 2026-10-11: section 1 names the start card and `submitter-<world>.key`; a WORLD other
  than `forge` uses its own name in claims and messages. Nothing changes for `forge`.
- 0.7, 2026-10-09: the standing loop's first step posts any run report you hold but have not
  posted, such as the run-4a report.
- 0.6, 2026-10-09: section 4 adds the change subscription, a WebSocket that delivers each verdict
  the moment it is ruled.
- 0.5, 2026-10-09: section 5 is the standing loop. The runs come from RUNS.md in the spec
  canonical, so the operator's prompt is one fixed sentence.
- 0.4, 2026-10-09: section 7, the comms channel (forge-to-owner and owner-to-forge); section 5
  posts the run report there; section 6 posts gaps and questions there.

- 0.3, 2026-10-07: every request carries the submitter key as a bearer token; the base URL comes
  from its file; one slot per ask by default; section 5 adds the loop (re-read the asks after every
  verdict, claim any open ask, stop when none is open); this change list.
- 0.2, 2026-10-07: first published version. One round, 3 asks with 3 slots each, no loop.
