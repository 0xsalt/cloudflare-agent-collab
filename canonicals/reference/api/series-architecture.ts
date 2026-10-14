import { parseCandidate, type ObsEvent, type SeriesContext } from "../events";
export const ask = "series-architecture";
const KIND_ORDER = ["claim", "fork", "push", "verdict"];
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
export function derive(events: readonly ObsEvent[], _ctx: SeriesContext) {
  const forkEvents = events.filter((e) => e.kind === "fork");
  const latest = new Map<string, { at: string; verdict: string }>();
  for (const e of events) {
    if (e.kind !== "verdict") continue;
    const prev = latest.get(e.subject);
    if (prev === undefined || e.at >= prev.at) latest.set(e.subject, { at: e.at, verdict: String(e.fields.verdict) });
  }
  const forks = forkEvents
    .map((e) => ({ name: e.subject, canonical: str(e.fields.canonical), world: str(e.fields.world), objective: str(e.fields.objective), verdict: latest.get(e.subject)?.verdict ?? null }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const worldCount = new Map<string, number>();
  for (const f of forks) if (f.world !== null) worldCount.set(f.world, (worldCount.get(f.world) ?? 0) + 1);
  const canon = new Map<string, number>();
  for (const f of forks) if (f.canonical !== null) canon.set(f.canonical, (canon.get(f.canonical) ?? 0) + 1);
  for (const e of events) if (e.kind === "push" && parseCandidate(e.subject) === null && !canon.has(e.subject)) canon.set(e.subject, 0);
  const byKey = <T>(m: Map<string, T>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const operations = events
    .filter((e) => KIND_ORDER.includes(e.kind))
    .map((e) => {
      if (e.kind === "claim") return { at: e.at, kind: e.kind, from: String(e.fields.claimed_by ?? "").split("/")[0] ?? "", to: "control" };
      if (e.kind === "fork") return { at: e.at, kind: e.kind, from: str(e.fields.canonical) ?? "", to: e.subject };
      if (e.kind === "push") return { at: e.at, kind: e.kind, from: parseCandidate(e.subject)?.world ?? "authority", to: e.subject };
      return { at: e.at, kind: e.kind, from: "authority", to: e.subject };
    })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0)));
  return {
    worlds: byKey(worldCount).map(([world, n]) => ({ world, forks: n })),
    canonicals: byKey(canon).map(([name, n]) => ({ name, forks: n })),
    forks,
    operations,
  };
}
