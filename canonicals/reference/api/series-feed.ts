import { parseCandidate, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-feed";
const LIMIT = 200;
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

export function derive(events: readonly ObsEvent[], ctx: SeriesContext) {
  const newestFirst = [...events].filter((e) => e.kind in KIND_ORDER).sort(byTime).reverse();
  const items = newestFirst.slice(0, LIMIT).map((e) => ({
    at: e.at, kind: e.kind, actor: actorOf(e), subject: e.subject,
    verdict: e.kind === "verdict" ? str(e.fields.verdict) : null, line: lineOf(e),
  }));
  return { now: ctx.now.toISOString(), total: newestFirst.length, items };
}
