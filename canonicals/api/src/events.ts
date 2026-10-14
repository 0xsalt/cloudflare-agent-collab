// The observatory's event schema and its first feed: the arena adapter.
// Reserved path (CONTRACT.md). Every series derives from ObsEvent[]; a new source adds an
// adapter here and every series works on it unchanged.

export interface ObsEvent {
  readonly source: string;
  readonly kind: string;
  readonly subject: string;
  readonly at: string; // ISO-8601, UTC
  readonly fields: Readonly<Record<string, string | number | null>>;
}

export interface SeriesContext {
  readonly now: Date;
  readonly subject?: string;
}

export class NotBuiltError extends Error {
  constructor(readonly ask: string) {
    super(`${ask} is an open ask; no candidate has been admitted for it yet`);
  }
}

export function notBuilt(ask: string): never {
  throw new NotBuiltError(ask);
}

// cand--<objective>--<world>--<harness>--<agent>--<session>
export interface CandidateName {
  readonly objective: string;
  readonly world: string;
  readonly harness: string;
  readonly agent: string;
  readonly session: string;
}

export function parseCandidate(name: string): CandidateName | null {
  const parts = name.split("--");
  if (parts.length !== 6 || parts[0] !== "cand") return null;
  const [, objective, world, harness, agent, session] = parts as [string, string, string, string, string, string];
  return { objective, world, harness, agent, session };
}

// Nearest-rank percentile: the value at index ceil(p * n) - 1 of the ascending values.
export function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.min(i, sorted.length - 1)] ?? null;
}

// The control Worker's /api/state, as the arena adapter reads it.
export interface ArenaState {
  readonly repos?: readonly { name: string; role: string; parent: string | null; created_at: string }[];
  readonly events?: readonly {
    id: number; type: string; repo: string; ref: string | null; after: string | null;
    message: string | null; event_ts: string | null; received_at: string;
  }[];
  readonly arenaClaims?: readonly { id: number; canonical: string; objective: string; slots: number; claimed_by: string; claimed_at: string }[];
  readonly verdicts?: readonly {
    candidate: string; canonical: string; objective: string; verdict: string; reason: string;
    commit: string; merge_commit: string | null; tag: string | null; ruled_at: string;
  }[];
  readonly decisions?: readonly {
    id: number; class: string; status: string; subject: string; kind: string;
    record: {
      decision_requested?: { summary?: string };
      why_now?: { red_criteria?: readonly string[] };
      recommendation?: { choice?: string };
    };
    opened_at: string; decided_at: string | null; action: string | null; actor: string | null;
  }[];
}

const SOURCE = "arena";

// Kinds: claim, fork, push, verdict, decision. Order is not significant; series sort for themselves.
export function fromArenaState(state: ArenaState): ObsEvent[] {
  const out: ObsEvent[] = [];
  for (const c of state.arenaClaims ?? []) {
    out.push({
      source: SOURCE, kind: "claim", subject: `claim-${c.id}`, at: c.claimed_at,
      fields: { canonical: c.canonical, objective: c.objective, slots: c.slots, claimed_by: c.claimed_by },
    });
  }
  for (const r of state.repos ?? []) {
    if (r.role !== "candidate") continue;
    const n = parseCandidate(r.name);
    out.push({
      source: SOURCE, kind: "fork", subject: r.name, at: r.created_at,
      fields: {
        canonical: r.parent, objective: n?.objective ?? null, world: n?.world ?? null,
        harness: n?.harness ?? null, agent: n?.agent ?? null, session: n?.session ?? null,
      },
    });
  }
  for (const e of state.events ?? []) {
    if (e.type !== "cf.artifacts.repo.pushed") continue;
    out.push({
      source: SOURCE, kind: "push", subject: e.repo, at: e.received_at,
      fields: { ref: e.ref, commit: e.after, emitted_at: e.event_ts, message: e.message },
    });
  }
  for (const v of state.verdicts ?? []) {
    out.push({
      source: SOURCE, kind: "verdict", subject: v.candidate, at: v.ruled_at,
      fields: {
        verdict: v.verdict, reason: v.reason, commit: v.commit, canonical: v.canonical,
        objective: v.objective, merge_commit: v.merge_commit, tag: v.tag,
      },
    });
  }
  for (const d of state.decisions ?? []) {
    out.push({
      source: SOURCE, kind: "decision", subject: `decision-${d.id}`, at: d.opened_at,
      fields: {
        class: d.class, kind: d.kind, status: d.status, action: d.action, actor: d.actor,
        decided_at: d.decided_at, subject: d.subject,
        red_criteria: (d.record.why_now?.red_criteria ?? []).join(","),
        summary: d.record.decision_requested?.summary ?? null,
        recommendation: d.record.recommendation?.choice ?? null,
      },
    });
  }
  return out;
}
