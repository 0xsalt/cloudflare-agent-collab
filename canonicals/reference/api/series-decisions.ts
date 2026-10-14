import type { ObsEvent, SeriesContext } from "../events";
export const ask = "series-decisions";
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Item {
  id: number; class: string; kind: string; subject: string; summary: string | null; recommendation: string | null;
  red_criteria: string[]; opened_at: string; decided_at: string | null; action: string | null; actor: string | null;
}

export function derive(events: readonly ObsEvent[], _ctx: SeriesContext) {
  const rows: (Item & { status: string })[] = events.filter((e) => e.kind === "decision").map((e) => ({
    id: Number(e.subject.replace(/^decision-/, "")),
    class: String(e.fields.class ?? ""), kind: String(e.fields.kind ?? ""), subject: String(e.fields.subject ?? ""),
    summary: str(e.fields.summary), recommendation: str(e.fields.recommendation),
    red_criteria: str(e.fields.red_criteria)?.split(",") ?? [],
    opened_at: e.at, decided_at: str(e.fields.decided_at), action: str(e.fields.action), actor: str(e.fields.actor),
    status: String(e.fields.status ?? ""),
  }));
  const strip = ({ status: _status, ...item }: Item & { status: string }): Item => item;
  const open = rows.filter((r) => r.status === "open").sort((a, b) => cmp(b.opened_at, a.opened_at) || b.id - a.id).map(strip);
  const decided = rows.filter((r) => r.status === "decided").sort((a, b) => cmp(b.decided_at ?? "", a.decided_at ?? "") || b.id - a.id).map(strip);
  const count = (c: string): number => rows.filter((r) => r.class === c).length;
  return { open, decided, by_class: { red: count("red"), yellow: count("yellow"), green: count("green") } };
}
