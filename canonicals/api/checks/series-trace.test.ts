// Check for SPEC.md "Ask: series-trace". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-trace";
import { EVENTS, NOW } from "./harness";

const B = "cand--series-push-rate--forge--claude--w2--s1";

test("series-trace: claim to verdict for one candidate, in time order", () => {
  expect(derive(EVENTS, { now: NOW, subject: B })).toEqual({
    candidate: B,
    steps: [
      { kind: "claim", at: "2026-10-07T06:40:00.000Z", detail: "forge/claude/s1" },
      { kind: "fork", at: "2026-10-07T06:40:03.000Z", detail: "api" },
      { kind: "push", at: "2026-10-07T06:43:00.000Z", detail: "refs/heads/main" },
      { kind: "verdict", at: "2026-10-07T06:44:40.000Z", detail: "SEND_BACK" },
      { kind: "push", at: "2026-10-07T06:50:00.000Z", detail: "refs/heads/main" },
      { kind: "verdict", at: "2026-10-07T06:51:00.000Z", detail: "REFUSE" },
    ],
  });
});

test("series-trace: an unknown subject has no steps", () => {
  expect(derive(EVENTS, { now: NOW, subject: "cand--x--y--z--a--b" })).toEqual({ candidate: "cand--x--y--z--a--b", steps: [] });
});
