import type { ObsEvent, SeriesContext } from "../events";
export const ask = "series-verdict-matrix";
export function derive(events: readonly ObsEvent[], _ctx: SeriesContext) {
  const latest = new Map<string, { at: number; verdict: string }>();
  for (const e of events) {
    if (e.kind !== "verdict") continue;
    const t = Date.parse(e.at);
    const cur = latest.get(e.subject);
    if (!cur || t >= cur.at) latest.set(e.subject, { at: t, verdict: String(e.fields.verdict) });
  }
  const rows = new Map<string, { objective: string; world: string; harness: string; candidates: number; admit: number; refuse: number; send_back: number; owed: number }>();
  for (const e of events) {
    if (e.kind !== "fork") continue;
    const objective = String(e.fields.objective), world = String(e.fields.world), harness = String(e.fields.harness);
    const key = `${objective}\u0000${world}\u0000${harness}`;
    const r = rows.get(key) ?? { objective, world, harness, candidates: 0, admit: 0, refuse: 0, send_back: 0, owed: 0 };
    r.candidates++;
    const v = latest.get(e.subject)?.verdict;
    if (v === "ADMIT") r.admit++; else if (v === "REFUSE") r.refuse++; else if (v === "SEND_BACK") r.send_back++; else r.owed++;
    rows.set(key, r);
  }
  return { rows: [...rows.values()].sort((a, b) => a.objective.localeCompare(b.objective) || a.world.localeCompare(b.world) || a.harness.localeCompare(b.harness)) };
}
