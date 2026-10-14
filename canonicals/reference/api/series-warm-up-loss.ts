import type { ObsEvent, SeriesContext } from "../events";
export const ask = "series-warm-up-loss";
export function derive(events: readonly ObsEvent[], ctx: SeriesContext) {
  const pushed = new Set<string>();
  const pushedRepo = new Set<string>();
  const ruled = new Set<string>();
  for (const e of events) {
    if (e.kind === "push") { pushedRepo.add(e.subject); if (e.fields.ref === "refs/heads/main") pushed.add(`${e.subject} ${e.fields.commit}`); }
    if (e.kind === "verdict") ruled.add(e.subject);
  }
  const lost = new Map<string, { candidate: string; commit: string }>();
  for (const e of events) {
    if (e.kind !== "verdict") continue;
    const commit = String(e.fields.commit);
    if (!pushed.has(`${e.subject} ${commit}`)) lost.set(`${e.subject} ${commit}`, { candidate: e.subject, commit });
  }
  const silent = events.filter((e) => e.kind === "fork" && ctx.now.getTime() - Date.parse(e.at) >= 600_000 && !pushedRepo.has(e.subject) && !ruled.has(e.subject)).map((e) => e.subject).sort();
  const lostList = [...lost.values()].sort((a, b) => a.candidate.localeCompare(b.candidate) || a.commit.localeCompare(b.commit));
  return { lost: lostList, silent, count: lostList.length + silent.length };
}
