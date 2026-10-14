// Check for SPEC.md "Ask: series-push-rate". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-push-rate";
import { EVENTS, NOW } from "./harness";

test("series-push-rate: push events per minute, last 30 minutes", () => {
  const out = derive(EVENTS, { now: NOW }) as { window_minutes: number; points: { minute: string; count: number }[] };
  expect(out.window_minutes).toBe(30);
  expect(out.points).toHaveLength(30);
  expect(out.points[0]).toEqual({ minute: "2026-10-07T06:31:00.000Z", count: 0 });
  expect(out.points[29]).toEqual({ minute: "2026-10-07T07:00:00.000Z", count: 0 });
  const nonzero = out.points.filter((p) => p.count > 0);
  expect(nonzero).toEqual([
    { minute: "2026-10-07T06:42:00.000Z", count: 2 },
    { minute: "2026-10-07T06:43:00.000Z", count: 1 },
    { minute: "2026-10-07T06:44:00.000Z", count: 1 },
    { minute: "2026-10-07T06:47:00.000Z", count: 1 },
    { minute: "2026-10-07T06:50:00.000Z", count: 1 },
    { minute: "2026-10-07T06:59:00.000Z", count: 1 },
  ]);
});
