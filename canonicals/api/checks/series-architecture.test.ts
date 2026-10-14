// Check for SPEC.md "Ask: series-architecture". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-architecture";
import { EVENTS, NOW } from "./harness";

type Arch = {
  worlds: { world: string; forks: number }[];
  canonicals: { name: string; forks: number }[];
  forks: { name: string; canonical: string | null; world: string | null; objective: string | null; verdict: string | null }[];
  operations: { at: string; kind: string; from: string; to: string }[];
};

test("series-architecture: worlds and canonicals, counted by fork", () => {
  const a = derive(EVENTS, { now: NOW }) as Arch;
  expect(a.worlds).toEqual([{ world: "commons", forks: 1 }, { world: "forge", forks: 4 }]);
  expect(a.canonicals).toEqual([{ name: "api", forks: 3 }, { name: "site", forks: 2 }]);
});

test("series-architecture: one fork per fork event, by name, with its latest verdict", () => {
  const a = derive(EVENTS, { now: NOW }) as Arch;
  expect(a.forks.map((f) => [f.name, f.canonical, f.world, f.objective, f.verdict])).toEqual([
    ["cand--series-push-rate--forge--claude--w1--s1", "api", "forge", "series-push-rate", "ADMIT"],
    ["cand--series-push-rate--forge--claude--w2--s1", "api", "forge", "series-push-rate", "REFUSE"],
    ["cand--series-trace--forge--codex--w1--s3", "api", "forge", "series-trace", "SEND_BACK"],
    ["cand--view-trace--commons--script--a1--s2", "site", "commons", "view-trace", null],
    ["cand--view-trace--forge--claude--w1--s5", "site", "forge", "view-trace", "ADMIT"],
  ]);
});

test("series-architecture: every operation, oldest first, with its edge", () => {
  const a = derive(EVENTS, { now: NOW }) as Arch;
  expect(a.operations).toHaveLength(22);
  expect(a.operations[0]).toEqual({ at: "2026-10-07T06:01:00.000Z", kind: "push", from: "authority", to: "api" });
  expect(a.operations[1]).toEqual({ at: "2026-10-07T06:29:58.000Z", kind: "claim", from: "forge", to: "control" });
  expect(a.operations[2]).toEqual({ at: "2026-10-07T06:30:00.000Z", kind: "fork", from: "api", to: "cand--series-trace--forge--codex--w1--s3" });
  expect(a.operations[7]).toEqual({ at: "2026-10-07T06:42:10.000Z", kind: "push", from: "forge", to: "cand--series-push-rate--forge--claude--w1--s1" });
  expect(a.operations[21]).toEqual({ at: "2026-10-07T06:59:30.000Z", kind: "push", from: "authority", to: "site" });
  const kinds: Record<string, number> = {};
  for (const o of a.operations) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  expect(kinds).toEqual({ claim: 4, fork: 5, push: 8, verdict: 5 });
});

test("series-architecture: no events gives empty lists", () => {
  expect(derive([], { now: NOW })).toEqual({ worlds: [], canonicals: [], forks: [], operations: [] });
});
