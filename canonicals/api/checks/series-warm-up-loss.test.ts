// Check for SPEC.md "Ask: series-warm-up-loss". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-warm-up-loss";
import { EVENTS, NOW } from "./harness";

test("series-warm-up-loss: ruled commits with no push event, and silent forks", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    lost: [{ candidate: "cand--series-trace--forge--codex--w1--s3", commit: "dddddddddddddddddddddddddddddddddddddd01" }],
    silent: ["cand--view-trace--commons--script--a1--s2"],
    count: 2,
  });
});
