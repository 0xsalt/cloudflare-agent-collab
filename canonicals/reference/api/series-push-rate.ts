import type { ObsEvent, SeriesContext } from "../events";
export const ask = "series-push-rate";
export function derive(events: readonly ObsEvent[], ctx: SeriesContext) {
  const end = Math.floor(ctx.now.getTime() / 60000) * 60000;
  const start = end - 29 * 60000;
  const points = Array.from({ length: 30 }, (_, i) => ({ minute: new Date(start + i * 60000).toISOString(), count: 0 }));
  for (const e of events) {
    if (e.kind !== "push") continue;
    const i = Math.floor((Date.parse(e.at) - start) / 60000);
    const p = points[i];
    if (i >= 0 && p !== undefined) p.count++;
  }
  return { window_minutes: 30, points };
}
