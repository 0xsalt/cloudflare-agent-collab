# observatory: forge runs

Version 0.1, 2026-10-09. The forge reads this file under BOOTSTRAP.md section 5, the standing
loop. The first run marked `Done: no` whose objectives are not all admitted is the next run. The
owner adds runs here; the board shows the next run as its NEXT FORGE PROMPT.

## Run 4a: run 3's open questions as spec amendments

Objectives: amend-*
Done: yes

```text
Run 4a: propose spec amendments. You ended run 3 with eight questions the files left open. The
arena now takes amendments to the spec canonical. Answer seven of them as seven amendments.

1. Read CONTRACT.md 0.2.3 again (GET /api/spec/file/CONTRACT.md), section "Amending the spec".
2. Answer each question below with one amendment: claim canonical spec, objective amend-<slug>,
   one slot, world forge, harness codex, your usual key.
3. Change only SPEC.md or CONTRACT.md. Only add lines, at most 40, inside the section that left
   the question open. Add no heading at levels 1 to 3 and no Ask heading.
4. Say what the arena already does. Derive each answer from your own admitted code and the
   verdicts you saw, never from a guess. The amendment decides the question.
5. Put the usual note fields on the tip, with canonical spec, plus
   cites: {"candidate": "<repo name>", "commit": "<40-character sha>"}. Cite the ADMIT of the ask
   whose build met the question. Do not cite run 3's SEND_BACKs on series-now or series-runs:
   those were the authority's own reference and generator errors, the replay check no longer
   reproduces them, and the amendment is then refused.
6. Name the question and the section in the note's reason.
7. After each push, wait for the ruling. When every check passes, the amendment waits for the
   owner on the board. If the owner's admit reports a merge conflict, fetch spec main, merge it,
   and push again.

Question 1 (does a candidate exist before its fork event) is already answered in SPEC 0.2.1
section 2. Skip it. The seven to answer:

- amend-orphan-verdict: does a verdict on a name with no fork event update the agent's roster
  row, and does it add a candidate?
- amend-tie-order: at equal timestamps, which event is the latest verdict, and what is the sort
  order of events?
- amend-median-admit: for median seconds to admit, which push and which ADMIT count, and how many
  times does a candidate count?
- amend-unlisted-ref: how does a feed line read for a push on a ref the line table does not list,
  for a candidate and for a canonical?
- amend-product-address: where are the product address and its viewer credential published, and
  how does a candidate verify its view?
- amend-above-fold: what does "without scrolling" mean for the page, and does any check measure it?
- amend-rerule: when does the authority rule a ruled tip again, and what happens to the earlier
  rulings?

Report each objective, its candidate name and its verdict when you finish.
```

## Run 4b: build series-decisions and view-decisions

Objectives: series-decisions, view-decisions
Done: no

```text
Run 4b: build the two open asks, series-decisions on api and view-decisions on site.

1. Read CONTRACT.md again (GET /api/spec/file/CONTRACT.md). It may carry amendments from run 4a.
2. Read SPEC.md (GET /api/spec/file/SPEC.md): section 2 for the decision events, section 8 for
   Ask: series-decisions and Ask: view-decisions.
3. Claim one slot on api for series-decisions and one slot on site for view-decisions: world
   forge, harness codex, your usual key.
4. In each fork, change only the ask's file: src/series/series-decisions.ts on api,
   views/view-decisions.js on site.
5. Derive every answer from the input. The hidden check feeds inputs you cannot see, so an answer
   copied from the fixture fails.
6. Run bun test ./checks/<ask>.test.ts until it passes, then push and add the note.
7. Wait for each ruling. On SEND_BACK, read the reason, fix the file in the same fork, and push
   again with a fresh note.
8. Build series-decisions first: view-decisions renders its output.

When you finish, post a report message on forge-to-owner (BOOTSTRAP.md section 7): each ask,
its candidate name, its verdicts, its release tag, and every question the files left open.
```
