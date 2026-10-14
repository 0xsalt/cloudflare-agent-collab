import { parseCandidate, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-now";
const IDLE_AFTER_MS = 60 * 60_000;
const KIND_ORDER: Record<string, number> = { claim: 0, fork: 1, push: 2, verdict: 3 };
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: ObsEvent, b: ObsEvent): number => Date.parse(a.at) - Date.parse(b.at) || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || cmp(a.subject, b.subject);

// The actor an event belongs to: "world/harness" for an agent, "authority" for the admission authority.
function actorOf(e: ObsEvent): string {
  if (e.kind === "claim") return str(e.fields.claimed_by).split("/").slice(0, 2).join("/");
  if (e.kind === "fork") return `${str(e.fields.world)}/${str(e.fields.harness)}`;
  if (e.kind === "push") {
    const c = parseCandidate(e.subject);
    const ref = str(e.fields.ref);
    if (c !== null && (ref === "refs/heads/main" || ref === "refs/notes/commits")) return `${c.world}/${c.harness}`;
  }
  return "authority";
}

// One line of words per event, without the actor (the row or the chip carries it).
function lineOf(e: ObsEvent): string {
  const c = parseCandidate(e.subject);
  const who = c === null ? e.subject : `${c.objective} slot ${c.agent}`;
  if (e.kind === "claim") {
    const n = Number(e.fields.slots);
    return `claimed ${n} ${n === 1 ? "slot" : "slots"} on ${str(e.fields.canonical)} for ${str(e.fields.objective)}`;
  }
  if (e.kind === "fork") return `forked ${str(e.fields.canonical)} for ${str(e.fields.objective)}, slot ${str(e.fields.agent)}`;
  if (e.kind === "push") {
    const ref = str(e.fields.ref);
    const msg = str(e.fields.message);
    if (c !== null) {
      if (ref === "refs/heads/main") return msg === "" ? `pushed ${who}` : `pushed ${who}: ${msg}`;
      if (ref === "refs/notes/commits") return `noted ${who}`;
      if (ref === "refs/notes/admission") return `admission note on ${who}`;
      return `pushed ${ref} on ${who}`;
    }
    if (ref === "refs/heads/main") return msg === "" ? `${e.subject} main` : `${e.subject} main: ${msg}`;
    if (ref.startsWith("refs/tags/")) return `${e.subject} tagged ${ref.slice(10)}`;
    if (ref.startsWith("refs/notes/")) return `${e.subject} notes updated`;
    return `${e.subject} ${ref}`;
  }
  return `${str(e.fields.verdict)} ${who}: ${str(e.fields.reason)}`;
}

interface Cand { actor: string; lastSubmit: number | null; verdict: { at: number; verdict: string } | null }
interface Actor { world: string; harness: string; last: ObsEvent | null; slots: number; forks: number }

export function derive(events: readonly ObsEvent[], ctx: SeriesContext) {
  const now = ctx.now.getTime();
  const sorted = [...events].filter((e) => e.kind in KIND_ORDER).sort(byTime);
  const cands = new Map<string, Cand>();
  for (const e of sorted) if (e.kind === "fork") cands.set(e.subject, { actor: actorOf(e), lastSubmit: null, verdict: null });
  for (const e of sorted) {
    const c = cands.get(e.subject);
    if (c === undefined) continue;
    const t = Date.parse(e.at);
    if (e.kind === "push" && (e.fields.ref === "refs/heads/main" || e.fields.ref === "refs/notes/commits")) c.lastSubmit = t;
    if (e.kind === "verdict") c.verdict = { at: t, verdict: str(e.fields.verdict) };
  }
  const awaiting = (c: Cand): boolean => c.lastSubmit !== null && (c.verdict === null || c.lastSubmit > c.verdict.at);
  const open = (c: Cand): boolean => c.verdict === null || c.verdict.verdict === "SEND_BACK";

  const actors = new Map<string, Actor>();
  const touch = (name: string, e: ObsEvent, world: string, harness: string): Actor => {
    const a = actors.get(name) ?? { world, harness, last: null, slots: 0, forks: 0 };
    a.last = e;
    actors.set(name, a);
    return a;
  };
  for (const e of sorted) {
    const name = actorOf(e);
    const c = parseCandidate(e.subject);
    if (name === "authority") {
      touch(name, e, "authority", "admission");
      // A verdict is also the last thing that happened to the candidate's agent.
      if (e.kind === "verdict" && c !== null) touch(`${c.world}/${c.harness}`, e, c.world, c.harness);
      continue;
    }
    const [world = "", harness = ""] = name.split("/");
    const a = touch(name, e, world, harness);
    if (e.kind === "claim") a.slots += Number(e.fields.slots) || 0;
    if (e.kind === "fork") a.forks += 1;
  }

  const rows = [...actors.entries()].map(([actor, a]) => {
    const last = a.last as ObsEvent;
    const since = Date.parse(last.at);
    const mine = [...cands.values()].filter((c) => actor === "authority" || c.actor === actor);
    const owed = mine.filter(awaiting).length;
    // The order follows the published ask text: idle when stale or when nothing is open; then
    // claiming, awaiting-verdict, building.
    let state: string;
    if (actor === "authority") {
      state = mine.some((c) => awaiting(c) && now - (c.lastSubmit ?? 0) <= IDLE_AFTER_MS) ? "ruling" : "idle";
    } else if (now - since > IDLE_AFTER_MS || !mine.some(open)) state = "idle";
    else if (a.slots > a.forks) state = "claiming";
    else if (owed > 0) state = "awaiting-verdict";
    else state = "building";
    return { actor, world: a.world, harness: a.harness, state, since: last.at, last: { at: last.at, kind: last.kind, line: lineOf(last) }, open: mine.filter(open).length, owed };
  });
  rows.sort((x, y) => (x.actor === "authority" ? 1 : 0) - (y.actor === "authority" ? 1 : 0) || cmp(x.actor, y.actor));
  return { now: ctx.now.toISOString(), actors: rows };
}
