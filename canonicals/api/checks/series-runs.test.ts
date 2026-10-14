// Check for SPEC.md "Ask: series-runs". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-runs";
import type { ObsEvent } from "../src/events";
import { EVENTS, NOW } from "./harness";

type Runs = { runs: Record<string, unknown>[] };

test("series-runs: one card per burst of claims from one world and harness, newest first", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    runs: [
      {
        actor: "commons/script", world: "commons", harness: "script", started: "2026-10-07T06:45:00.000Z", ended: "2026-10-07T06:45:01.000Z",
        claims: 1, slots: 1, candidates: 1, admit: 0, refuse: 0, send_back: 0, owed: 1, median_seconds_to_admit: null,
      },
      {
        actor: "forge/claude", world: "forge", harness: "claude", started: "2026-10-07T06:40:00.000Z", ended: "2026-10-07T06:51:00.000Z",
        claims: 2, slots: 3, candidates: 3, admit: 2, refuse: 1, send_back: 0, owed: 0, median_seconds_to_admit: 75,
      },
      {
        actor: "forge/codex", world: "forge", harness: "codex", started: "2026-10-07T06:29:58.000Z", ended: "2026-10-07T06:35:00.000Z",
        claims: 1, slots: 1, candidates: 1, admit: 0, refuse: 0, send_back: 1, owed: 0, median_seconds_to_admit: null,
      },
    ],
  });
});

test("series-runs: a claim more than 15 minutes after the previous one starts a new burst", () => {
  const claim: ObsEvent = {
    source: "arena", kind: "claim", subject: "claim-5", at: "2026-10-07T07:20:00.000Z",
    fields: { canonical: "api", objective: "series-queue-lag", slots: 1, claimed_by: "forge/claude/s9" },
  };
  const out = derive([...EVENTS, claim], { now: NOW }) as Runs;
  expect(out.runs).toHaveLength(4);
  expect(out.runs[0]).toEqual({
    actor: "forge/claude", world: "forge", harness: "claude", started: "2026-10-07T07:20:00.000Z", ended: "2026-10-07T07:20:00.000Z",
    claims: 1, slots: 1, candidates: 0, admit: 0, refuse: 0, send_back: 0, owed: 0, median_seconds_to_admit: null,
  });
  expect(out.runs[2]).toMatchObject({ actor: "forge/claude", started: "2026-10-07T06:40:00.000Z", claims: 2 });
});

test("series-runs: a claim within 15 minutes joins the burst", () => {
  const claim: ObsEvent = {
    source: "arena", kind: "claim", subject: "claim-5", at: "2026-10-07T07:00:00.000Z",
    fields: { canonical: "api", objective: "series-queue-lag", slots: 2, claimed_by: "forge/claude/s9" },
  };
  const out = derive([...EVENTS, claim], { now: NOW }) as Runs;
  expect(out.runs).toHaveLength(3);
  expect(out.runs[1]).toMatchObject({ actor: "forge/claude", started: "2026-10-07T06:40:00.000Z", ended: "2026-10-07T07:00:00.000Z", claims: 3, slots: 5, candidates: 3 });
});

test("series-runs: no events gives no runs", () => {
  expect(derive([], { now: NOW })).toEqual({ runs: [] });
});
