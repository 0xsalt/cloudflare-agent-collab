import { parseCandidate, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-trace";
const ORDER: Record<string, number> = { claim: 0, fork: 1, push: 2, verdict: 3 };
export function derive(events: readonly ObsEvent[], ctx: SeriesContext) {
  const candidate = ctx.subject ?? "";
  const n = parseCandidate(candidate);
  const steps: { kind: string; at: string; detail: string }[] = [];
  for (const e of events) {
    if (e.kind === "claim" && n && e.fields.objective === n.objective && e.fields.claimed_by === `${n.world}/${n.harness}/${n.session}`) steps.push({ kind: "claim", at: e.at, detail: String(e.fields.claimed_by) });
    if (e.subject !== candidate) continue;
    if (e.kind === "fork") steps.push({ kind: "fork", at: e.at, detail: String(e.fields.canonical) });
    if (e.kind === "push") steps.push({ kind: "push", at: e.at, detail: String(e.fields.ref) });
    if (e.kind === "verdict") steps.push({ kind: "verdict", at: e.at, detail: String(e.fields.verdict) });
  }
  if (!steps.some((s) => s.kind !== "claim")) return { candidate, steps: [] };
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
  return { candidate, steps };
}
