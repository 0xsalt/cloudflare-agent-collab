// The hidden check (ISSUE-00008, ruled 2026-10-07): a held-out test per ask that a candidate
// cannot read. The public check asserts exact outputs on one fixture the candidate can see, so a
// hardcoded answer passes it. The hidden check generates fresh inputs at every admission, computes
// the expected outputs HERE from the authority's private reference (canonicals/reference/), runs
// only the candidate's file in the sandbox on those inputs, and compares outside the sandbox.
// Expected outputs never enter the sandbox, so candidate code cannot read them.

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

export interface HiddenRun {
  /** Files to write into the candidate's clone before the sandbox run, path relative to the clone. */
  readonly files: Record<string, string>;
  /** The script the sandbox runs with `bun run`, relative to the clone. */
  readonly driver: string;
  /** Where the driver writes its output, relative to the clone. */
  readonly output: string;
  /** Compares the driver's output with the expected outputs; returns failing case indexes. */
  readonly judge: (output: unknown) => { cases: number; failed: number[] };
}

const rand = (n: number): number => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % n;
const hex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Key order does not matter to the public check's toEqual, so it must not matter here.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Returns true when the authority holds a reference, and so a hidden check, for this ask. */
export async function hasHidden(canonicalName: string, objective: string): Promise<boolean> {
  const ext = canonicalName === "api" ? "ts" : "js";
  return Bun.file(join(ROOT, "canonicals", "reference", canonicalName, `${objective}.${ext}`)).exists();
}

export async function prepareHidden(canonicalName: string, objective: string, workdir: string): Promise<HiddenRun> {
  if (canonicalName === "api") return prepareApi(objective, workdir);
  if (canonicalName === "site") return prepareSite(objective);
  throw new Error(`no hidden check for canonical ${canonicalName}`);
}

// ---------------------------------------------------------------- api: series

interface Ev { source: string; kind: string; subject: string; at: string; fields: Record<string, string | number | null> }

const shiftIso = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

// A field that carries a time moves with the event's own time: a push's emitted_at, a decision's
// decided_at (ISSUE-00021), so an ordering by decision time keeps its meaning.
const TIME_FIELDS = ["emitted_at", "decided_at"] as const;
function shiftFields(fields: Ev["fields"], ms: number): Ev["fields"] {
  const out = { ...fields };
  for (const k of TIME_FIELDS) {
    const v = out[k];
    if (typeof v === "string") out[k] = shiftIso(v, ms);
  }
  return out;
}

async function prepareApi(objective: string, workdir: string): Promise<HiddenRun> {
  // The reference runs here, beside a trusted copy of the canonical's events.ts.
  const refDir = join(workdir, "hidden-ref", hex(4));
  await rm(refDir, { recursive: true, force: true });
  await mkdir(join(refDir, "src", "series"), { recursive: true });
  await Bun.write(join(refDir, "src", "events.ts"), Bun.file(join(ROOT, "canonicals", "api", "src", "events.ts")));
  await Bun.write(join(refDir, "src", "series", `${objective}.ts`), Bun.file(join(ROOT, "canonicals", "reference", "api", `${objective}.ts`)));
  const events = (await import(join(refDir, "src", "events.ts"))) as { fromArenaState: (s: unknown) => Ev[] };
  const ref = (await import(join(refDir, "src", "series", `${objective}.ts`))) as { derive: (e: readonly Ev[], c: { now: Date }) => unknown };
  const fixture = await Bun.file(join(ROOT, "canonicals", "api", "checks", "fixture-state.json")).json();
  const base = events.fromArenaState(fixture);
  const NOW = Date.parse("2026-10-07T07:00:00.000Z");

  // Each case: a random subset of the public fixture's events, every timestamp shifted by one
  // random offset, and a random `now`. Counts, durations and windows all move. A candidate's
  // pushes and verdicts stay only when its fork event stays: the arena never shows a candidate
  // without its fork (repos persist in the state), and run 3 showed that fork-less candidates
  // only make candidates guess at an input the product never sees (SPEC 2, ISSUE-00020).
  const cases: { events: Ev[]; now: string }[] = [];
  const expected: string[] = [];
  const isCandidate = (subject: string): boolean => /^cand--[^-]+(?:-[^-]+)*--[a-z0-9]+--[a-z0-9]+--[a-z0-9-]+--[a-z0-9]+$/.test(subject) && subject.split("--").length === 6;
  for (let i = 0; i < 10; i++) {
    const shift = (rand(2) === 0 ? 0 : rand(72) - 36) * 3_600_000 + rand(3_600) * 1000;
    const keep = 40 + rand(56);
    const sampled = base.filter(() => rand(100) < keep);
    const forks = new Set(sampled.filter((e) => e.kind === "fork").map((e) => e.subject));
    const subset = sampled.filter((e) => e.kind === "claim" || e.kind === "fork" || !isCandidate(e.subject) || forks.has(e.subject)).map((e) => ({
      ...e,
      at: shiftIso(e.at, shift),
      fields: shiftFields(e.fields, shift),
    }));
    const now = new Date(NOW + shift + (rand(41) - 20) * 60_000);
    let out: unknown;
    try {
      out = await ref.derive(subset, { now });
    } catch {
      continue; // The reference refuses this input; it proves nothing about the candidate.
    }
    cases.push({ events: subset, now: now.toISOString() });
    expected.push(canonical(JSON.parse(JSON.stringify(out ?? null))));
  }
  await rm(refDir, { recursive: true, force: true });

  const tag = hex(6);
  const driver = `checks/h-${tag}.ts`;
  const input = `checks/h-${tag}.in.json`;
  const output = `checks/h-${tag}.out.json`;
  const source = [
    `import { derive } from "../src/series/${objective}";`,
    `const cases = (await Bun.file(new URL("./h-${tag}.in.json", import.meta.url)).json()) as { events: never[]; now: string }[];`,
    `const out: unknown[] = [];`,
    `for (const c of cases) {`,
    `  try { out.push({ ok: true, value: await derive(c.events, { now: new Date(c.now) }) }); }`,
    `  catch (e) { out.push({ ok: false, error: String(e).slice(0, 200) }); }`,
    `}`,
    `await Bun.write(new URL("./h-${tag}.out.json", import.meta.url), JSON.stringify(out));`,
  ].join("\n");

  return {
    files: { [driver]: source, [input]: JSON.stringify(cases) },
    driver,
    output,
    judge: (raw) => judgeList(raw, expected.length, (got, i) => got.ok === true && canonical(JSON.parse(JSON.stringify(got.value ?? null))) === expected[i]),
  };
}

function judgeList(raw: unknown, n: number, ok: (got: { ok?: boolean; value?: unknown }, i: number) => boolean): { cases: number; failed: number[] } {
  const list = Array.isArray(raw) ? (raw as { ok?: boolean; value?: unknown }[]) : [];
  const failed: number[] = [];
  for (let i = 0; i < n; i++) { const got = list[i]; if (got === undefined || !ok(got, i)) failed.push(i); }
  return { cases: n, failed };
}

// ---------------------------------------------------------------- site: views

interface Dumped { attrs: Record<string, string>; text: string }
interface Rendered { root: string; els: Dumped[] }

const T0 = Date.parse("2026-10-07T06:00:00.000Z");
const word = (p: string): string => `${p}${hex(2)}`;
const candName = (): string => `cand--${word("series-")}--${word("w")}--${word("h")}--${word("a")}--${word("s")}`;
function nearestRank(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(Math.max(0, Math.ceil(p * sorted.length) - 1), sorted.length - 1)] ?? null;
}

// Each view: a payload generator, and a judge that mirrors its public check on that payload.
const VIEWS: Record<string, { gen: () => unknown; judge: (data: never, r: Rendered) => boolean }> = {
  "view-push-rate": {
    gen: () => {
      const start = T0 + rand(600) * 60_000;
      return { window_minutes: 30, points: Array.from({ length: 30 }, (_, i) => ({ minute: new Date(start + i * 60_000).toISOString(), count: rand(4) === 0 ? rand(9) : 0 })) };
    },
    judge: (d: { points: { count: number }[] }, r) => {
      const counts = r.els.filter((e) => "data-count" in e.attrs).map((e) => Number(e.attrs["data-count"]));
      const totals = r.els.filter((e) => "data-total" in e.attrs).map((e) => e.attrs["data-total"]);
      return canonical(counts) === canonical(d.points.map((p) => p.count)) && canonical(totals) === canonical([String(d.points.reduce((s, p) => s + p.count, 0))]);
    },
  },
  "view-time-to-admit": {
    gen: () => {
      const secs = Array.from({ length: 1 + rand(6) }, () => 5 + rand(900)).sort((a, b) => a - b);
      return { samples: secs.map((s) => ({ candidate: candName(), seconds: s })), p50: nearestRank(secs, 0.5), p90: nearestRank(secs, 0.9), max: secs.at(-1) ?? null };
    },
    judge: (d: { samples: { candidate: string; seconds: number }[]; p50: number; p90: number; max: number }, r) => {
      const rows = r.els.filter((e) => "data-candidate" in e.attrs).map((e) => [e.attrs["data-candidate"], e.attrs["data-seconds"] ?? null]);
      const stat = (n: string): string => r.els.find((e) => e.attrs["data-stat"] === n)?.text ?? "";
      return canonical(rows) === canonical(d.samples.map((s) => [s.candidate, String(s.seconds)]))
        && stat("p50").includes(String(d.p50)) && stat("p90").includes(String(d.p90)) && stat("max").includes(String(d.max));
    },
  },
  "view-verdict-matrix": {
    gen: () => ({
      rows: Array.from({ length: 1 + rand(6) }, () => ({
        objective: word("series-"), world: word("w"), harness: word("h"),
        candidates: rand(9), admit: rand(3), refuse: rand(5), send_back: rand(5), owed: rand(3),
      })),
    }),
    judge: (d: { rows: Record<string, string | number>[] }, r) => {
      const rows = r.els.filter((e) => "data-row" in e.attrs);
      if (canonical(rows.map((e) => e.attrs["data-row"])) !== canonical(d.rows.map((x) => `${x.objective}/${x.world}/${x.harness}`))) return false;
      return d.rows.every((x, i) => ["candidates", "admit", "refuse", "send_back", "owed"].every((k) => rows[i]?.attrs[`data-${k.replace("_", "-")}`] === String(x[k])));
    },
  },
  "view-architecture-live": {
    gen: () => {
      const worlds = Array.from({ length: 1 + rand(3) }, () => word("w"));
      const canons = Array.from({ length: 1 + rand(4) }, () => word("c"));
      const forks = Array.from({ length: rand(6) }, () => ({ name: candName(), canonical: canons[rand(canons.length)] ?? "api", world: worlds[rand(worlds.length)] ?? "forge", objective: word("series-"), verdict: ["ADMIT", "REFUSE", "SEND_BACK", null][rand(4)] ?? null }));
      const count = (k: "world" | "canonical", v: string): number => forks.filter((f) => f[k] === v).length;
      let t = T0 + rand(600) * 60_000;
      const kinds = ["claim", "fork", "push", "verdict"];
      return {
        worlds: worlds.map((w) => ({ world: w, forks: count("world", w) })),
        canonicals: canons.map((c) => ({ name: c, forks: count("canonical", c) })),
        forks,
        operations: Array.from({ length: rand(9) }, () => {
          t += (1 + rand(120)) * 1000;
          return { at: new Date(t).toISOString(), kind: kinds[rand(4)] ?? "push", from: word("f"), to: word("t") };
        }),
      };
    },
    judge: (d: { worlds: { world: string; forks: number }[]; canonicals: { name: string; forks: number }[]; forks: { name: string; canonical: string; world: string; verdict: string | null }[]; operations: { at: string; kind: string; from: string; to: string }[] }, r) => {
      const pick = (attr: string, keys: string[]): (string | null)[][] => r.els.filter((e) => attr in e.attrs).map((e) => keys.map((k) => e.attrs[k] ?? null));
      return canonical(pick("data-node", ["data-node"])) === canonical([["cloudflare"], ["control"], ["queue"], ["durable-object"]])
        && canonical(pick("data-world", ["data-world", "data-forks"])) === canonical(d.worlds.map((w) => [w.world, String(w.forks)]))
        && canonical(pick("data-canonical", ["data-canonical", "data-forks"])) === canonical(d.canonicals.map((c) => [c.name, String(c.forks)]))
        && canonical(pick("data-fork", ["data-fork", "data-in", "data-from", "data-verdict"])) === canonical(d.forks.map((f) => [f.name, f.canonical, f.world, f.verdict ?? "none"]))
        && canonical(pick("data-op", ["data-op", "data-at", "data-edge"])) === canonical(d.operations.map((o) => [o.kind, o.at, `${o.from}->${o.to}`]));
    },
  },
  "view-trace": {
    gen: () => {
      const kinds = ["claim", "fork", "push", "verdict"];
      let t = T0 + rand(600) * 60_000;
      return {
        candidate: candName(),
        steps: Array.from({ length: 2 + rand(6) }, () => {
          t += (1 + rand(300)) * 1000;
          return { kind: kinds[rand(kinds.length)] ?? "push", at: new Date(t).toISOString(), detail: word("detail-") };
        }),
      };
    },
    judge: (d: { candidate: string; steps: { kind: string; at: string; detail: string }[] }, r) => {
      const steps = r.els.filter((e) => "data-step" in e.attrs);
      return canonical(steps.map((e) => [e.attrs["data-step"], e.attrs["data-at"] ?? null])) === canonical(d.steps.map((s) => [s.kind, s.at]))
        && d.steps.every((s, i) => steps[i]?.text.includes(s.detail) === true) && r.root.includes(d.candidate);
    },
  },
  "view-now": {
    gen: () => {
      const states = ["claiming", "building", "awaiting-verdict", "idle"];
      const now = T0 + rand(600) * 60_000;
      const agents = Array.from({ length: rand(4) }, () => `${word("w")}/${word("h")}`).sort();
      const names = rand(3) === 0 ? agents : [...agents, "authority"];
      return {
        now: new Date(now).toISOString(),
        actors: names.map((actor) => {
          const since = now - rand(7200) * 1000;
          const [world = "", harness = ""] = actor === "authority" ? ["authority", "admission"] : actor.split("/");
          return {
            actor, world, harness, state: actor === "authority" ? (rand(2) === 0 ? "ruling" : "idle") : states[rand(4)] ?? "idle", since: new Date(since).toISOString(),
            last: { at: new Date(since).toISOString(), kind: ["claim", "fork", "push", "verdict"][rand(4)] ?? "push", line: `${word("did-")} ${word("thing-")}` },
            open: rand(4), owed: rand(3),
          };
        }),
      };
    },
    judge: (d: { now: string; actors: { actor: string; state: string; since: string; last: { line: string } }[] }, r) => {
      const now = Date.parse(d.now);
      const rows = r.els.filter((e) => "data-actor" in e.attrs);
      const head = r.els.find((e) => "data-headline" in e.attrs);
      if (head === undefined || head.attrs["data-actors"] !== String(d.actors.length)) return false;
      for (const s of ["claiming", "building", "awaiting-verdict", "ruling", "idle"]) {
        if (head.attrs[`data-${s}`] !== String(d.actors.filter((a) => a.state === s).length)) return false;
      }
      return canonical(rows.map((e) => [e.attrs["data-actor"], e.attrs["data-state"], e.attrs["data-since"], e.attrs["data-age"]]))
        === canonical(d.actors.map((a) => [a.actor, a.state, a.since, String(Math.max(0, Math.round((now - Date.parse(a.since)) / 1000)))]))
        && d.actors.every((a, i) => rows[i]?.text.includes(a.last.line) === true);
    },
  },
  "view-feed": {
    gen: () => {
      const now = T0 + rand(600) * 60_000;
      const n = rand(4) === 0 ? 26 + rand(20) : rand(26);
      const kinds = ["claim", "fork", "push", "verdict"];
      const verdicts = ["ADMIT", "REFUSE", "SEND_BACK"];
      let t = now;
      const items = Array.from({ length: n }, () => {
        t -= (1 + rand(120)) * 1000;
        const kind = kinds[rand(4)] ?? "push";
        return { at: new Date(t).toISOString(), kind, actor: rand(3) === 0 ? "authority" : `${word("w")}/${word("h")}`, subject: candName(), verdict: kind === "verdict" ? verdicts[rand(3)] ?? "ADMIT" : null, line: `${word("did-")} ${word("thing-")}` };
      });
      return { now: new Date(now).toISOString(), total: n + rand(50), items };
    },
    judge: (d: { total: number; items: { at: string; kind: string; actor: string; verdict: string | null; line: string }[] }, r) => {
      const rows = r.els.filter((e) => "data-kind" in e.attrs);
      const head = r.els.find((e) => "data-headline" in e.attrs);
      const shown = Math.min(25, d.items.length);
      if (head === undefined || head.attrs["data-total"] !== String(d.total) || head.attrs["data-shown"] !== String(shown)) return false;
      if (canonical(rows.map((e) => [e.attrs["data-at"], e.attrs["data-kind"], e.attrs["data-actor"], e.attrs["data-verdict"]])) !== canonical(d.items.map((i) => [i.at, i.kind, i.actor, i.verdict ?? "none"]))) return false;
      if (!d.items.every((it, i) => rows[i]?.text.includes(it.line) === true)) return false;
      const more = r.els.filter((e) => "data-more" in e.attrs);
      if (d.items.length <= 25) return more.length === 0;
      const m = more[0];
      return more.length === 1 && m !== undefined && m.attrs["data-more"] === String(d.items.length - 25)
        && d.items.slice(25).every((it) => m.text.includes(it.line)) && !m.text.includes(d.items[24]?.line ?? "\u0000");
    },
  },
  "view-runs": {
    gen: () => {
      let t = T0 + rand(600) * 60_000;
      return {
        runs: Array.from({ length: rand(5) }, () => {
          t -= (20 + rand(600)) * 60_000;
          const claims = 1 + rand(8);
          const admit = rand(claims + 1);
          return {
            actor: `${word("w")}/${word("h")}`, world: word("w"), harness: word("h"), started: new Date(t).toISOString(), ended: new Date(t + (1 + rand(1200)) * 1000).toISOString(),
            claims, slots: claims + rand(3), candidates: claims + rand(2), admit, refuse: rand(3), send_back: rand(3), owed: rand(2),
            median_seconds_to_admit: admit === 0 || rand(4) === 0 ? null : 5 + rand(600),
          };
        }),
      };
    },
    judge: (d: { runs: Record<string, string | number | null>[] }, r) => {
      const cards = r.els.filter((e) => "data-run" in e.attrs);
      const head = r.els.find((e) => "data-headline" in e.attrs);
      if (head === undefined || head.attrs["data-runs"] !== String(d.runs.length)) return false;
      const keys = ["actor", "started", "ended", "claims", "slots", "candidates", "admit", "refuse", "send_back", "owed"];
      return canonical(cards.map((c) => [...keys.map((k) => c.attrs[`data-${k.replace("_", "-")}`] ?? null), c.attrs["data-median"] ?? null]))
        === canonical(d.runs.map((x) => [...keys.map((k) => String(x[k])), x.median_seconds_to_admit === null ? "none" : String(x.median_seconds_to_admit)]))
        && d.runs.every((x, i) => cards[i]?.text.includes(String(x.actor)) === true);
    },
  },
  "view-decisions": {
    gen: () => {
      const actions = ["approve", "choose_alternative", "request_evidence", "challenge_assumption", "request_options", "modify_redirect", "defer", "reject", "stop"];
      const criteria = ["reserved", "authority_error", "outward_facing", "destructive"];
      let t = T0 + rand(600) * 60_000;
      let id = 0;
      const item = (isOpen: boolean) => {
        t -= (1 + rand(90)) * 60_000;
        const cls = isOpen ? "red" : ["red", "yellow", "green"][rand(3)] ?? "red";
        const action = !isOpen && cls === "red" ? actions[rand(actions.length)] ?? "stop" : null;
        return {
          id: ++id, class: cls, kind: cls === "red" ? ["reserved_path", "admission_error"][rand(2)] ?? "reserved_path" : cls === "yellow" ? "send_back" : "admit",
          subject: candName(), summary: `${word("ask-")} ${word("thing-")}`, recommendation: word("rec-"),
          red_criteria: cls === "red" ? [criteria[rand(criteria.length)] ?? "reserved"] : [],
          opened_at: new Date(t).toISOString(), decided_at: isOpen ? null : new Date(t + rand(30) * 60_000).toISOString(),
          action, actor: action === null ? null : ["viewer", "admin"][rand(2)] ?? "viewer",
        };
      };
      return {
        open: Array.from({ length: rand(4) }, () => item(true)).reverse(),
        decided: Array.from({ length: rand(5) }, () => item(false)).reverse(),
        by_class: { red: 0, yellow: 0, green: 0 },
      };
    },
    judge: (d: { open: { id: number; class: string; kind: string; subject: string; summary: string; recommendation: string }[]; decided: { id: number; action: string | null }[] }, r) => {
      const head = r.els.find((e) => "data-headline" in e.attrs);
      if (head === undefined || head.attrs["data-open"] !== String(d.open.length) || head.attrs["data-decided"] !== String(d.decided.length)) return false;
      const said = d.open.length === 0 ? "No decision needs a human" : d.open.length === 1 ? "1 decision needs a human" : `${d.open.length} decisions need a human`;
      if (!head.text.includes(said)) return false;
      const items = r.els.filter((e) => "data-decision" in e.attrs);
      const open = items.filter((e) => "data-class" in e.attrs);
      const decided = items.filter((e) => "data-action" in e.attrs);
      return canonical(open.map((e) => [e.attrs["data-decision"], e.attrs["data-class"], e.attrs["data-kind"], e.attrs["data-subject"]]))
        === canonical(d.open.map((x) => [String(x.id), x.class, x.kind, x.subject]))
        && d.open.every((x, i) => open[i]?.text.includes(x.summary) === true && open[i]?.text.includes(x.recommendation) === true)
        && canonical(decided.map((e) => [e.attrs["data-decision"], e.attrs["data-action"]])) === canonical(d.decided.map((x) => [String(x.id), x.action ?? "none"]));
    },
  },
};

function prepareSite(objective: string): HiddenRun {
  const view = VIEWS[objective];
  if (view === undefined) throw new Error(`no hidden check for site ask ${objective}`);
  const payloads = Array.from({ length: 6 }, () => view.gen());
  const tag = hex(6);
  const driver = `checks/h-${tag}.ts`;
  const output = `checks/h-${tag}.out.json`;
  // The driver dumps what the view rendered: every element carrying a data-* attribute, in
  // document order, with its text. The judge applies the ask's rules outside the sandbox.
  const source = [
    `import * as view from "../views/${objective}.js";`,
    `import { all, fakeDocument } from "./dom";`,
    `const payloads = (await Bun.file(new URL("./h-${tag}.in.json", import.meta.url)).json()) as unknown[];`,
    `const out: unknown[] = [];`,
    `for (const p of payloads) {`,
    `  try {`,
    `    const root = fakeDocument.createElement("div");`,
    `    view.render(root, p, fakeDocument);`,
    `    const els = all(root).filter((e) => [...e.attributes.keys()].some((k) => k.startsWith("data-")))`,
    `      .map((e) => ({ attrs: Object.fromEntries([...e.attributes].filter(([k]) => k.startsWith("data-"))), text: e.textContent }));`,
    `    out.push({ ok: true, value: { root: root.textContent, els } });`,
    `  } catch (e) { out.push({ ok: false, error: String(e).slice(0, 200) }); }`,
    `}`,
    `await Bun.write(new URL("./h-${tag}.out.json", import.meta.url), JSON.stringify(out));`,
  ].join("\n");
  return {
    files: { [driver]: source, [`checks/h-${tag}.in.json`]: JSON.stringify(payloads) },
    driver,
    output,
    judge: (raw) => judgeList(raw, payloads.length, (got, i) => {
      if (got.ok !== true) return false;
      try {
        return view.judge(payloads[i] as never, got.value as Rendered);
      } catch {
        return false;
      }
    }),
  };
}
