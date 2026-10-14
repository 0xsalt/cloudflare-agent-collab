import { nearestRank, parseCandidate, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-runs";
const GAP_MS = 15 * 60_000;
const KIND_ORDER: Record<string, number> = { claim: 0, fork: 1, push: 2, verdict: 3 };
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: ObsEvent, b: ObsEvent): number => Date.parse(a.at) - Date.parse(b.at) || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || cmp(a.subject, b.subject);

interface Claim { at: string; t: number; key: string; slots: number }

export function derive(events: readonly ObsEvent[], _ctx: SeriesContext) {
  const sorted = [...events].filter((e) => e.kind in KIND_ORDER).sort(byTime);
  // Claims by actor (world/harness), in time order.
  const claimsBy = new Map<string, Claim[]>();
  for (const e of sorted) {
    if (e.kind !== "claim") continue;
    const by = str(e.fields.claimed_by);
    const actor = by.split("/").slice(0, 2).join("/");
    const list = claimsBy.get(actor) ?? [];
    list.push({ at: e.at, t: Date.parse(e.at), key: `${str(e.fields.objective)}\u0000${by}`, slots: Number(e.fields.slots) || 0 });
    claimsBy.set(actor, list);
  }
  // Per candidate: its claim key, first branch push, first ADMIT, latest verdict.
  const cands = new Map<string, { key: string; firstMain: number | null; firstAdmit: number | null; verdict: string | null; last: number }>();
  for (const e of sorted) {
    if (e.kind !== "fork") continue;
    const n = parseCandidate(e.subject);
    const key = `${str(e.fields.objective)}\u0000${str(e.fields.world)}/${str(e.fields.harness)}/${str(e.fields.session)}`;
    if (n !== null) cands.set(e.subject, { key, firstMain: null, firstAdmit: null, verdict: null, last: Date.parse(e.at) });
  }
  for (const e of sorted) {
    const c = cands.get(e.subject);
    if (c === undefined) continue;
    const t = Date.parse(e.at);
    c.last = Math.max(c.last, t);
    if (e.kind === "push" && e.fields.ref === "refs/heads/main" && c.firstMain === null) c.firstMain = t;
    if (e.kind === "verdict") {
      c.verdict = str(e.fields.verdict);
      if (c.verdict === "ADMIT" && c.firstAdmit === null) c.firstAdmit = t;
    }
  }
  const runs = [];
  for (const [actor, claims] of claimsBy) {
    const [world = "", harness = ""] = actor.split("/");
    let burst: Claim[] = [];
    const flush = (): void => {
      if (burst.length === 0) return;
      const keys = new Set(burst.map((c) => c.key));
      const mine = [...cands.values()].filter((c) => keys.has(c.key));
      const count = (v: string | null): number => mine.filter((c) => c.verdict === v).length;
      const admits = mine.flatMap((c) => (c.firstMain !== null && c.firstAdmit !== null ? [Math.round((c.firstAdmit - c.firstMain) / 1000)] : [])).sort((a, b) => a - b);
      const ended = Math.max(...burst.map((c) => c.t), ...mine.map((c) => c.last));
      runs.push({
        actor, world, harness, started: burst[0]?.at ?? "", ended: new Date(ended).toISOString(),
        claims: burst.length, slots: burst.reduce((s, c) => s + c.slots, 0), candidates: mine.length,
        admit: count("ADMIT"), refuse: count("REFUSE"), send_back: count("SEND_BACK"), owed: count(null),
        median_seconds_to_admit: nearestRank(admits, 0.5),
      });
      burst = [];
    };
    for (const c of claims) {
      const prev = burst[burst.length - 1];
      if (prev !== undefined && c.t - prev.t > GAP_MS) flush();
      burst.push(c);
    }
    flush();
  }
  runs.sort((a, b) => cmp(b.started, a.started) || cmp(a.actor, b.actor));
  return { runs };
}
