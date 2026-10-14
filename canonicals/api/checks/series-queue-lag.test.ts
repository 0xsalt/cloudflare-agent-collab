// Check for SPEC.md "Ask: series-queue-lag". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-queue-lag";
import { EVENTS, NOW } from "./harness";

test("series-queue-lag: received minus emitted, push events that carry emitted_at", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({ samples: 7, p50_ms: 2000, p95_ms: 3000, max_ms: 3000 });
});

test("series-queue-lag: no samples gives zero samples and nulls", () => {
  expect(derive([], { now: NOW })).toEqual({ samples: 0, p50_ms: null, p95_ms: null, max_ms: null });
});
