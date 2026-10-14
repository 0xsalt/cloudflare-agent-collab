import { nearestRank, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-queue-lag";
export function derive(events: readonly ObsEvent[], _ctx: SeriesContext) {
  const v = events.filter((e) => e.kind === "push" && typeof e.fields.emitted_at === "string")
    .map((e) => Date.parse(e.at) - Date.parse(String(e.fields.emitted_at))).sort((a, b) => a - b);
  return { samples: v.length, p50_ms: nearestRank(v, 0.5), p95_ms: nearestRank(v, 0.95), max_ms: v.length ? v[v.length - 1] : null };
}
