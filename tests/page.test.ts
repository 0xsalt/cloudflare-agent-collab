// The board's feed story (ISSUE-00023): one row per verdict with its plumbing folded under it,
// probe traffic labelled, and the last run naming the latest non-probe run. The board script's pure
// section (everything before the red control) runs here against a run-3-shaped fixture.
import { expect, test } from "bun:test";
import { PAGE_HTML } from "../src/page";
import { join } from "node:path";
import { parseRuns } from "../src/runs";

// The runs as RUNS.md holds them, with run 4a reopened so the test walks every state.
const parsedRuns = parseRuns(await Bun.file(join(import.meta.dir, "..", "canonicals", "spec", "RUNS.md")).text());
if ("error" in parsedRuns) throw new Error(parsedRuns.error);
const FORGE_PROMPTS = parsedRuns.runs.map((r) => ({ ...r, done: false }));

interface Board {
  eventsOf(s: unknown): Array<{ kind: string; probe?: boolean; at: string }>;
  feedRows(events: unknown[]): Array<{ e: { kind: string; verdict?: string; subject: string }; fold: unknown[] }>;
  runsOf(events: unknown[]): Array<{ actor: string; admit: number }>;
  actorOf(e: unknown): string;
  isProbeActor(actor: string): boolean;
  roster(events: unknown[]): Array<{ actor: string; state: string; open: number; owed: number }>;
  paState(events: unknown[]): { state: string; since: string | null; last: string | null; owed: number };
  IDLE_AFTER: number;
  setNow(t: number): void;
  endTime(start: string, end: string): string;
  nextRun(prompts: unknown[], asks: unknown[], events: unknown[]): { prompt: { run: string } | null; status: string };
  amendAsks(events: unknown[]): Array<{ id: string; canonical: string }>;
  askTiles(asks: unknown[], events: unknown[], waiting?: Set<string>): Array<{ id: string; state: string; agents: string[]; forks: number; last: { verdict: string } | null }>;
}

function board(): Board {
  const script = PAGE_HTML.split("<script>")[1].split("// ---- the red control")[0];
  // The section is this repository's own constant; it defines functions and touches no DOM.
  return new Function(`${script}; return { eventsOf, feedRows, runsOf, actorOf, isProbeActor, roster, paState, IDLE_AFTER, endTime, askTiles, amendAsks, nextRun, setNow: (t) => { NOW = t; } };`)() as Board;
}

const at = (s: number): string => new Date(Date.UTC(2026, 9, 9, 3, 0, 0) + s * 1000).toISOString();
const cand = (ask: string, world: string, harness: string, agent: string, session: string): string =>
  `cand--${ask}--${world}--${harness}--${agent}--${session}`;

function fixture(): unknown {
  const repos: unknown[] = [];
  const events: unknown[] = [];
  const verdicts: unknown[] = [];
  const arenaClaims: unknown[] = [];
  const push = (repo: string, ref: string, s: number): void => {
    events.push({ type: "cf.artifacts.repo.pushed", repo, ref, received_at: at(s), after: "0".repeat(40) });
  };
  // Run 3: six forge candidates, each ADMIT with canonical plumbing before and after the verdict.
  const asks = [["series-feed", "api"], ["view-feed", "site"], ["view-now", "site"], ["view-runs", "site"], ["series-runs", "api"], ["series-now", "api"]];
  asks.forEach(([ask, canonical], i) => {
    const session = `s${i}`;
    const name = cand(ask, "forge", "codex", "w1", session);
    arenaClaims.push({ id: i + 1, claimed_at: at(i * 4), canonical, objective: ask, slots: 1, claimed_by: `forge/codex/${session}` });
    repos.push({ name, role: "candidate", parent: canonical, created_at: at(i * 4 + 1) });
    const t = 200 + i * 40;
    push(name, "refs/heads/main", t - 20);
    push(name, "refs/notes/commits", t - 20);
    push(canonical, "refs/heads/main", t - 12);
    push(canonical, "refs/notes/commits", t - 12);
    push(canonical, "refs/notes/admission", t - 12);
    push(canonical, `refs/tags/v0.${i}.0`, t - 10);
    verdicts.push({ candidate: name, canonical, objective: ask, verdict: "ADMIT", reason: "ok", ruled_at: at(t) });
    push(name, "refs/notes/admission", t + 2);
  });
  // A spec publish far from any verdict stays its own row.
  push("spec", "refs/heads/main", 1500);
  // Later probe traffic: a legacy commons/script r1 probe and a harness-probe claim.
  const legacy = cand("series-decisions", "commons", "script", "r1", "a507");
  arenaClaims.push({ id: 7, claimed_at: at(3000), canonical: "api", objective: "series-decisions", slots: 1, claimed_by: "commons/script/a507" });
  repos.push({ name: legacy, role: "candidate", parent: "api", created_at: at(3001) });
  verdicts.push({ candidate: legacy, canonical: "api", objective: "series-decisions", verdict: "REFUSE", reason: "reserved path", ruled_at: at(3060) });
  push(legacy, "refs/notes/admission", 3062);
  arenaClaims.push({ id: 8, claimed_at: at(4000), canonical: "api", objective: "series-decisions", slots: 1, claimed_by: "commons/probe/b1c2" });
  // The arena.ts slice (a1) is a builder, not a probe.
  repos.push({ name: cand("feed-iso8601", "commons", "script", "a1", "ce53"), role: "candidate", parent: "api", created_at: at(-9000) });
  repos.push({ name: "api", role: "canonical", created_at: at(-10000) }, { name: "site", role: "canonical", created_at: at(-10000) });
  return { repos, events, verdicts, arenaClaims, decisions: [] };
}

test("each run-3 ADMIT is one feed row with its plumbing folded under it", () => {
  const b = board();
  const rows = b.feedRows(b.eventsOf(fixture()));
  const admits = rows.filter((r) => r.e.kind === "verdict" && r.e.verdict === "ADMIT");
  expect(admits).toHaveLength(6);
  for (const r of admits) expect(r.fold).toHaveLength(5);
  expect(rows.some((r) => r.e.kind === "push" && r.e.subject === "spec")).toBe(true);
  const authorityRows = rows.filter((r) => r.e.kind === "push" && b.actorOf(r.e) === "authority" && r.e.subject !== "spec");
  expect(authorityRows).toHaveLength(0);
});

test("probe traffic acts as world/probe; the arena.ts slice does not", () => {
  const b = board();
  const events = b.eventsOf(fixture());
  const actors = new Set(events.filter((e) => e.kind === "claim" || e.kind === "fork").map((e) => b.actorOf(e)));
  expect(actors).toEqual(new Set(["forge/codex", "commons/probe", "commons/script"]));
  expect(events.filter((e) => e.kind === "verdict" && e.probe)).toHaveLength(1);
});

test("a probe is one row: its claim, fork and admission note fold under its verdict", () => {
  const b = board();
  const rows = b.feedRows(b.eventsOf(fixture()));
  const probeRows = rows.filter((r) => (r.e as { probe?: boolean }).probe);
  // The REFUSE with three folded steps, and the harness-probe claim that has no verdict yet.
  expect(probeRows.map((r) => [r.e.kind, r.fold.length])).toEqual([["verdict", 3], ["claim", 0]]);
});

test("a submission is one row: the checks note folds under the candidate's main push", () => {
  const b = board();
  const rows = b.feedRows(b.eventsOf(fixture()));
  const subs = rows.filter((r) => r.e.kind === "push" && b.actorOf(r.e) === "forge/codex");
  expect(subs).toHaveLength(6);
  for (const r of subs) expect(r.fold).toHaveLength(1);
});

test("the latest non-probe run is run 3 with 6 ADMIT", () => {
  const b = board();
  const runs = b.runsOf(b.eventsOf(fixture()));
  expect(b.isProbeActor(runs[0].actor)).toBe(true);
  const story = runs.find((r) => !b.isProbeActor(r.actor));
  expect(story?.actor).toBe("forge/codex");
  expect(story?.admit).toBe(6);
});

test("a probe sent back is over: the probe actor reads idle with nothing open, a builder sent back stays open", () => {
  const b = board();
  const probe = cand("series-runs", "commons", "script", "p1", "1c25");
  const builder = cand("series-now", "forge", "codex", "w1", "d682");
  const s = {
    arenaClaims: [
      { id: 1, claimed_at: at(0), canonical: "api", objective: "series-runs", slots: 1, claimed_by: "commons/script/1c25" },
      { id: 2, claimed_at: at(0), canonical: "api", objective: "series-now", slots: 1, claimed_by: "forge/codex/d682" },
    ],
    repos: [{ name: probe, role: "candidate", parent: "api", created_at: at(1) }, { name: builder, role: "candidate", parent: "api", created_at: at(1) }],
    events: [probe, builder].map((repo) => ({ type: "cf.artifacts.repo.pushed", repo, ref: "refs/heads/main", received_at: at(60), after: "0".repeat(40) })),
    verdicts: [probe, builder].map((candidate) => ({ candidate, canonical: "api", verdict: "SEND_BACK", reason: "hidden", ruled_at: at(120) })),
    decisions: [],
  };
  b.setNow(Date.parse(at(600)));
  const rows = b.roster(b.eventsOf(s));
  const byActor = Object.fromEntries(rows.map((r) => [r.actor, r]));
  expect([byActor["commons/probe"].state, byActor["commons/probe"].open]).toEqual(["idle", 0]);
  expect([byActor["forge/codex"].state, byActor["forge/codex"].open]).toEqual(["building", 1]);
});

test("a run card's end time is a full time, with its date when the run crosses a day", () => {
  const b = board();
  expect(b.endTime(at(0), at(65))).toMatch(/01:05/);
  expect(b.endTime(at(0), at(3 * 86400))).toMatch(/Oct/);
});

test("spec map: tiles take their live state from events, and probe traffic never colours one", () => {
  const b = board();
  const events = b.eventsOf(fixture());
  const asks = [
    { id: "series-feed", canonical: "api", label: "HIGH", admitted: true, built: true, tag: "v0.0.0", admitted_from: "cand--series-feed--forge--codex--w1--s0" },
    { id: "view-now", canonical: "site", label: "HIGH", admitted: true, built: false, admitted_from: "cand--view-now--forge--codex--w1--s2" },
    { id: "series-decisions", canonical: "api", label: "HIGH", admitted: false, built: false },
  ];
  const tiles = b.askTiles(asks, events);
  expect(tiles.map((t) => [t.id, t.state])).toEqual([["series-feed", "deployed"], ["view-now", "admitted"], ["series-decisions", "open"]]);
  expect(tiles[0]?.agents).toEqual(["forge/codex w1"]);
  expect([tiles[0]?.forks, tiles[0]?.last?.verdict]).toEqual([1, "ADMIT"]);
});

test("spec map: a candidate moves forked, submitted, being checked, sent back", () => {
  const b = board();
  const name = cand("view-decisions", "forge", "codex", "w1", "9f00");
  const base = { arenaClaims: [{ id: 1, claimed_at: at(0), canonical: "site", objective: "view-decisions", slots: 1, claimed_by: "forge/codex/9f00" }], repos: [{ name, role: "candidate", parent: "site", created_at: at(1) }], verdicts: [] as unknown[], events: [] as unknown[], decisions: [] };
  const ask = [{ id: "view-decisions", canonical: "site", label: "HIGH", admitted: false, built: false }];
  const stateOf = (s: unknown): string | undefined => b.askTiles(ask, b.eventsOf(s))[0]?.state;
  expect(stateOf(base)).toBe("forked");
  base.events.push({ type: "cf.artifacts.repo.pushed", repo: name, ref: "refs/heads/main", received_at: at(60), after: "0".repeat(40) });
  expect(stateOf(base)).toBe("submitted");
  base.events.push({ type: "cf.artifacts.repo.pushed", repo: name, ref: "refs/notes/commits", received_at: at(61), after: "0".repeat(40) });
  expect(stateOf(base)).toBe("checking");
  base.verdicts.push({ candidate: name, canonical: "site", objective: "view-decisions", verdict: "SEND_BACK", reason: "check", ruled_at: at(120) });
  expect(stateOf(base)).toBe("sent back");
});

test("spec map: a builder's amendment is a tile that waits for the owner; a probe's is not", () => {
  const b = board();
  const name = cand("amend-tie-order", "forge", "codex", "w1", "aa01");
  const probe = cand("amend-gatecheck", "commons", "probe", "m1", "d6c6");
  const s = {
    arenaClaims: [{ id: 1, claimed_at: at(0), canonical: "spec", objective: "amend-tie-order", slots: 1, claimed_by: "forge/codex/aa01" }],
    repos: [{ name, role: "candidate", parent: "spec", created_at: at(1) }, { name: probe, role: "candidate", parent: "spec", created_at: at(1) }],
    events: [name, probe].flatMap((repo) => ["refs/heads/main", "refs/notes/commits"].map((ref, i) => ({ type: "cf.artifacts.repo.pushed", repo, ref, received_at: at(60 + i), after: "0".repeat(40) }))),
    verdicts: [], decisions: [],
  };
  const events = b.eventsOf(s);
  const asks = b.amendAsks(events);
  expect(asks.map((a) => a.id)).toEqual(["amend-tie-order"]);
  expect(b.askTiles(asks, events)[0]?.state).toBe("checking");
  expect(b.askTiles(asks, events, new Set([name]))[0]?.state).toBe("owner");
});

test("next forge prompt: waiting, running, idle, then the next run, then nothing", () => {
  const b = board();
  const asks = [{ id: "series-decisions", canonical: "api", admitted: false }, { id: "view-decisions", canonical: "site", admitted: false }];
  const amendObjectives = ["amend-fork-membership", "amend-verdict-ties"];
  const empty = { arenaClaims: [], repos: [], events: [], verdicts: [], decisions: [] };
  b.setNow(Date.parse(at(100)));
  expect([b.nextRun(FORGE_PROMPTS, asks, b.eventsOf(empty)).prompt?.run, b.nextRun(FORGE_PROMPTS, asks, b.eventsOf(empty)).status]).toEqual(["4a", "waiting"]);
  const claimed = { ...empty, arenaClaims: [{ id: 1, claimed_at: at(60), canonical: "spec", objective: amendObjectives[0], slots: 1, claimed_by: "forge/codex/aa01" }] };
  expect(b.nextRun(FORGE_PROMPTS, asks, b.eventsOf(claimed)).status).toBe("running");
  b.setNow(Date.parse(at(60 + 31 * 60)));
  expect(b.nextRun(FORGE_PROMPTS, asks, b.eventsOf(claimed)).status).toBe("idle");
  // A probe claim never starts a run.
  const probed = { ...empty, arenaClaims: [{ id: 2, claimed_at: at(60), canonical: "spec", objective: amendObjectives[0], slots: 1, claimed_by: "commons/probe/b8c6" }], repos: [{ name: cand(amendObjectives[0] ?? "", "commons", "probe", "m1", "b8c6"), role: "candidate", parent: "spec", created_at: at(61) }] };
  expect(b.nextRun(FORGE_PROMPTS, asks, b.eventsOf(probed)).status).toBe("waiting");
  const allAdmitted = { ...empty, arenaClaims: amendObjectives.map((o, i) => ({ id: 10 + i, claimed_at: at(70), canonical: "spec", objective: o, slots: 1, claimed_by: `forge/codex/s${i}` })), verdicts: amendObjectives.map((o, i) => ({ candidate: cand(o, "forge", "codex", "w1", `s${i}`), canonical: "spec", objective: o, verdict: "ADMIT", reason: "ok", ruled_at: at(90) })) };
  expect(b.nextRun(FORGE_PROMPTS, asks, b.eventsOf(allAdmitted)).prompt?.run).toBe("4b");
  const doneAll = FORGE_PROMPTS.map((p) => ({ ...p, done: true }));
  expect(b.nextRun(doneAll, asks, b.eventsOf(empty)).status).toBe("nothing");
});

// ISSUE-00039: the first-screen line says whether the authority is running or paused. Paused is derived,
// never a flag: no authority verdict or push for IDLE_AFTER.
function lastAuthorityAt(b: Board, s: unknown): string {
  const times = b.eventsOf(s).filter((e) => (e.kind === "verdict" || e.kind === "push") && b.actorOf(e) === "authority").map((e) => e.at);
  return times.reduce((a, c) => (Date.parse(c) > Date.parse(a) ? c : a));
}

test("pa-status: running when NOW is a few seconds after the newest authority event", () => {
  const b = board();
  const last = lastAuthorityAt(b, fixture());
  b.setNow(Date.parse(last) + 5000);
  const pa = b.paState(b.eventsOf(fixture()));
  expect([pa.state, pa.last, pa.since]).toEqual(["running", last, null]);
});

test("pa-status: paused once IDLE_AFTER and a minute have passed, since the newest authority event", () => {
  const b = board();
  const last = lastAuthorityAt(b, fixture());
  b.setNow(Date.parse(last) + b.IDLE_AFTER + 60 * 1000);
  const pa = b.paState(b.eventsOf(fixture()));
  expect([pa.state, pa.since, pa.last]).toEqual(["paused", last, last]);
  b.setNow(Date.parse(last) + b.IDLE_AFTER);
  expect(b.paState(b.eventsOf(fixture())).state).toBe("running");
  const none = b.paState(b.eventsOf({ repos: [], events: [], verdicts: [], arenaClaims: [], decisions: [] }));
  expect([none.state, none.since, none.last, none.owed]).toEqual(["none", null, null, 0]);
});

test("pa-status: owed is the authority roster row's owed count, from one awaiting rule", () => {
  const b = board();
  const s = fixture() as { repos: unknown[]; events: unknown[] };
  // The run-3 fixture owes nothing, so add one submitted candidate with no verdict: owed must be 1.
  const waiting = cand("view-decisions", "forge", "codex", "w1", "f00d");
  s.repos.push({ name: waiting, role: "candidate", parent: "site", created_at: at(3100) });
  s.events.push({ type: "cf.artifacts.repo.pushed", repo: waiting, ref: "refs/heads/main", received_at: at(3110), after: "0".repeat(40) });
  b.setNow(Date.parse(at(3120)));
  const events = b.eventsOf(s);
  const row = b.roster(events).find((r) => r.actor === "authority");
  expect(row?.owed).toBe(1);
  expect(b.paState(events).owed).toBe(row?.owed ?? -1);
  expect(b.paState(b.eventsOf(fixture())).owed).toBe(0);
});
