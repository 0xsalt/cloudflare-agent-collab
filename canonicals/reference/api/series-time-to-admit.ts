import { nearestRank, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-time-to-admit";
export function derive(events: readonly ObsEvent[], _ctx: SeriesContext) {
  const byTime = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const firstPush = new Map<string, number>();
  const firstAdmit = new Map<string, number>();
  for (const e of byTime) {
    if (e.kind === "push" && e.fields.ref === "refs/heads/main" && !firstPush.has(e.subject)) firstPush.set(e.subject, Date.parse(e.at));
    if (e.kind === "verdict" && e.fields.verdict === "ADMIT" && !firstAdmit.has(e.subject)) firstAdmit.set(e.subject, Date.parse(e.at));
  }
  const samples = [...firstAdmit].flatMap(([candidate, t]) => {
    const p = firstPush.get(candidate);
    return p === undefined ? [] : [{ candidate, seconds: Math.round((t - p) / 1000) }];
  }).sort((a, b) => a.seconds - b.seconds || a.candidate.localeCompare(b.candidate));
  const v = samples.map((s) => s.seconds);
  return { samples, p50: nearestRank(v, 0.5), p90: nearestRank(v, 0.9), max: v.length ? v[v.length - 1] : null };
}
