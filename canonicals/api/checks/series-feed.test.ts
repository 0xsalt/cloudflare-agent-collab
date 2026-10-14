// Check for SPEC.md "Ask: series-feed". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-feed";
import type { ObsEvent } from "../src/events";
import { EVENTS, NOW } from "./harness";

type Feed = { now: string; total: number; items: { at: string; kind: string; actor: string; subject: string; verdict: string | null; line: string }[] };

const A1 = "cand--series-push-rate--forge--claude--w1--s1";
const A2 = "cand--series-push-rate--forge--claude--w2--s1";
const T1 = "cand--series-trace--forge--codex--w1--s3";
const V1 = "cand--view-trace--commons--script--a1--s2";
const V2 = "cand--view-trace--forge--claude--w1--s5";

test("series-feed: every event newest first, with its actor, one line, and the verdict on a verdict row", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    now: "2026-10-07T07:00:00.000Z",
    total: 22,
    items: [
      { at: "2026-10-07T06:59:30.000Z", kind: "push", actor: "authority", subject: "site", verdict: null, line: "site main: Admit view-trace" },
      { at: "2026-10-07T06:51:00.000Z", kind: "verdict", actor: "authority", subject: A2, verdict: "REFUSE", line: "REFUSE series-push-rate slot w2: objective already admitted" },
      { at: "2026-10-07T06:50:00.000Z", kind: "push", actor: "forge/claude", subject: A2, verdict: null, line: "pushed series-push-rate slot w2: Resubmit" },
      { at: "2026-10-07T06:48:15.000Z", kind: "verdict", actor: "authority", subject: V2, verdict: "ADMIT", line: "ADMIT view-trace slot w1: every check passes" },
      { at: "2026-10-07T06:47:00.000Z", kind: "push", actor: "forge/claude", subject: V2, verdict: null, line: "pushed view-trace slot w1: Trace view" },
      { at: "2026-10-07T06:46:00.000Z", kind: "fork", actor: "forge/claude", subject: V2, verdict: null, line: "forked site for view-trace, slot w1" },
      { at: "2026-10-07T06:45:58.000Z", kind: "claim", actor: "forge/claude", subject: "claim-4", verdict: null, line: "claimed 1 slot on site for view-trace" },
      { at: "2026-10-07T06:45:01.000Z", kind: "fork", actor: "commons/script", subject: V1, verdict: null, line: "forked site for view-trace, slot a1" },
      { at: "2026-10-07T06:45:00.000Z", kind: "claim", actor: "commons/script", subject: "claim-3", verdict: null, line: "claimed 1 slot on site for view-trace" },
      { at: "2026-10-07T06:44:40.000Z", kind: "verdict", actor: "authority", subject: A2, verdict: "SEND_BACK", line: "SEND_BACK series-push-rate slot w2: check failed" },
      { at: "2026-10-07T06:44:30.000Z", kind: "push", actor: "authority", subject: "api", verdict: null, line: "api main: Admit series-push-rate" },
      { at: "2026-10-07T06:44:20.000Z", kind: "verdict", actor: "authority", subject: A1, verdict: "ADMIT", line: "ADMIT series-push-rate slot w1: every check passes" },
      { at: "2026-10-07T06:43:00.000Z", kind: "push", actor: "forge/claude", subject: A2, verdict: null, line: "pushed series-push-rate slot w2: Push rate" },
      { at: "2026-10-07T06:42:15.000Z", kind: "push", actor: "forge/claude", subject: A1, verdict: null, line: "noted series-push-rate slot w1" },
      { at: "2026-10-07T06:42:10.000Z", kind: "push", actor: "forge/claude", subject: A1, verdict: null, line: "pushed series-push-rate slot w1: Push rate" },
      { at: "2026-10-07T06:40:03.000Z", kind: "fork", actor: "forge/claude", subject: A2, verdict: null, line: "forked api for series-push-rate, slot w2" },
      { at: "2026-10-07T06:40:02.000Z", kind: "fork", actor: "forge/claude", subject: A1, verdict: null, line: "forked api for series-push-rate, slot w1" },
      { at: "2026-10-07T06:40:00.000Z", kind: "claim", actor: "forge/claude", subject: "claim-2", verdict: null, line: "claimed 2 slots on api for series-push-rate" },
      { at: "2026-10-07T06:35:00.000Z", kind: "verdict", actor: "authority", subject: T1, verdict: "SEND_BACK", line: "SEND_BACK series-trace slot w1: check failed" },
      { at: "2026-10-07T06:30:00.000Z", kind: "fork", actor: "forge/codex", subject: T1, verdict: null, line: "forked api for series-trace, slot w1" },
      { at: "2026-10-07T06:29:58.000Z", kind: "claim", actor: "forge/codex", subject: "claim-1", verdict: null, line: "claimed 1 slot on api for series-trace" },
      { at: "2026-10-07T06:01:00.000Z", kind: "push", actor: "authority", subject: "api", verdict: null, line: "api main: Seed api canonical" },
    ],
  });
});

test("series-feed: at most 200 items, the newest; total counts every event", () => {
  const many: ObsEvent[] = Array.from({ length: 250 }, (_, i) => ({
    source: "arena", kind: "push", subject: "api", at: new Date(Date.parse("2026-10-07T00:00:00.000Z") + i * 1000).toISOString(),
    fields: { ref: "refs/heads/main", commit: null, emitted_at: null, message: `Commit ${i}` },
  }));
  const out = derive(many, { now: NOW }) as Feed;
  expect(out.total).toBe(250);
  expect(out.items).toHaveLength(200);
  expect(out.items[0]).toEqual({ at: "2026-10-07T00:04:09.000Z", kind: "push", actor: "authority", subject: "api", verdict: null, line: "api main: Commit 249" });
  expect(out.items[199]?.line).toBe("api main: Commit 50");
});

test("series-feed: tag and note pushes on a canonical, and a push with no message", () => {
  const pushes: ObsEvent[] = [
    { source: "arena", kind: "push", subject: "api", at: "2026-10-07T06:10:00.000Z", fields: { ref: "refs/tags/v0.3.0", commit: null, emitted_at: null, message: null } },
    { source: "arena", kind: "push", subject: "api", at: "2026-10-07T06:11:00.000Z", fields: { ref: "refs/notes/admission", commit: null, emitted_at: null, message: null } },
    { source: "arena", kind: "push", subject: A1, at: "2026-10-07T06:12:00.000Z", fields: { ref: "refs/notes/admission", commit: null, emitted_at: null, message: null } },
    { source: "arena", kind: "push", subject: A1, at: "2026-10-07T06:13:00.000Z", fields: { ref: "refs/heads/main", commit: null, emitted_at: null, message: null } },
  ];
  expect((derive(pushes, { now: NOW }) as Feed).items.map((i) => [i.actor, i.line])).toEqual([
    ["forge/claude", "pushed series-push-rate slot w1"],
    ["authority", "admission note on series-push-rate slot w1"],
    ["authority", "api notes updated"],
    ["authority", "api tagged v0.3.0"],
  ]);
});

test("series-feed: no events gives an empty feed", () => {
  expect(derive([], { now: NOW })).toEqual({ now: "2026-10-07T07:00:00.000Z", total: 0, items: [] });
});
