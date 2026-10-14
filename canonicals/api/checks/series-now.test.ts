// Check for SPEC.md "Ask: series-now". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-now";
import type { ObsEvent } from "../src/events";
import { EVENTS, NOW } from "./harness";

type Now = { now: string; actors: { actor: string; world: string; harness: string; state: string; since: string; last: { at: string; kind: string; line: string }; open: number; owed: number }[] };

test("series-now: one row per world and harness, then the authority; state, since, last line, open, owed", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    now: "2026-10-07T07:00:00.000Z",
    actors: [
      {
        actor: "commons/script", world: "commons", harness: "script", state: "building", since: "2026-10-07T06:45:01.000Z",
        last: { at: "2026-10-07T06:45:01.000Z", kind: "fork", line: "forked site for view-trace, slot a1" }, open: 1, owed: 0,
      },
      {
        actor: "forge/claude", world: "forge", harness: "claude", state: "idle", since: "2026-10-07T06:51:00.000Z",
        last: { at: "2026-10-07T06:51:00.000Z", kind: "verdict", line: "REFUSE series-push-rate slot w2: objective already admitted" }, open: 0, owed: 0,
      },
      {
        actor: "forge/codex", world: "forge", harness: "codex", state: "building", since: "2026-10-07T06:35:00.000Z",
        last: { at: "2026-10-07T06:35:00.000Z", kind: "verdict", line: "SEND_BACK series-trace slot w1: check failed" }, open: 1, owed: 0,
      },
      {
        actor: "authority", world: "authority", harness: "admission", state: "idle", since: "2026-10-07T06:59:30.000Z",
        last: { at: "2026-10-07T06:59:30.000Z", kind: "push", line: "site main: Admit view-trace" }, open: 2, owed: 0,
      },
    ],
  });
});

test("series-now: a branch push after the latest verdict is awaiting a verdict, and the authority is ruling", () => {
  const push: ObsEvent = {
    source: "arena", kind: "push", subject: "cand--view-trace--commons--script--a1--s2", at: "2026-10-07T06:58:00.000Z",
    fields: { ref: "refs/heads/main", commit: "cccccccccccccccccccccccccccccccccccccccc", emitted_at: null, message: "Trace view" },
  };
  const out = derive([...EVENTS, push], { now: NOW }) as Now;
  expect(out.actors[0]).toEqual({
    actor: "commons/script", world: "commons", harness: "script", state: "awaiting-verdict", since: "2026-10-07T06:58:00.000Z",
    last: { at: "2026-10-07T06:58:00.000Z", kind: "push", line: "pushed view-trace slot a1: Trace view" }, open: 1, owed: 1,
  });
  expect(out.actors[3]).toMatchObject({ actor: "authority", state: "ruling", open: 2, owed: 1, since: "2026-10-07T06:59:30.000Z" });
});

test("series-now: an actor with no event in the last 60 minutes is idle since its last event", () => {
  const later = derive(EVENTS, { now: new Date("2026-10-07T09:00:00.000Z") }) as Now;
  expect(later.now).toBe("2026-10-07T09:00:00.000Z");
  expect(later.actors.map((a) => [a.actor, a.state, a.since])).toEqual([
    ["commons/script", "idle", "2026-10-07T06:45:01.000Z"],
    ["forge/claude", "idle", "2026-10-07T06:51:00.000Z"],
    ["forge/codex", "idle", "2026-10-07T06:35:00.000Z"],
    ["authority", "idle", "2026-10-07T06:59:30.000Z"],
  ]);
});

test("series-now: no events gives no actors", () => {
  expect(derive([], { now: NOW })).toEqual({ now: "2026-10-07T07:00:00.000Z", actors: [] });
});
