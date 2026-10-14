// Check for SPEC.md "Ask: series-time-to-admit". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-time-to-admit";
import { EVENTS, NOW } from "./harness";

test("series-time-to-admit: first branch push to first ADMIT, nearest-rank percentiles", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    samples: [
      { candidate: "cand--view-trace--forge--claude--w1--s5", seconds: 75 },
      { candidate: "cand--series-push-rate--forge--claude--w1--s1", seconds: 130 },
    ],
    p50: 75,
    p90: 130,
    max: 130,
  });
});

test("series-time-to-admit: no admits gives empty samples and nulls", () => {
  expect(derive([], { now: NOW })).toEqual({ samples: [], p50: null, p90: null, max: null });
});
