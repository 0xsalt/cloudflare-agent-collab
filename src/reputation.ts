// Per-PA contributor standing, policy v0 (ISSUE-00034, SPEC 17.5).
//
// A standing belongs to one (sovereign canonical, verified contributor) pair. The contributor is
// the WORLD that the claim route verified by its submitter key and wrote into the candidate name;
// harness, agent and session are self-declared and never split a standing. Only the PA writes
// outcome events. A standing orders the review queue and caps claim slots. It never grants an
// admit, a canonical write, or a skipped check: nothing in this module reads or writes a verdict.
//
// Pure functions only. The Durable Object stores the events (src/index.ts); the authority maps
// its rulings to outcomes with outcomeFromRuling and posts them.

export const REVIEW_POLICY_V0 = {
  version: "review-policy/0",
  minScore: -10,
  maxScore: 10,
  lowAt: -3,
  establishedAt: 3,
  maxCorrection: 10,
  checkFailureAllowance: 2,
  // A head of the review queue that has waited this long is reviewed first, whatever its standing.
  maxWaitMs: 30 * 60 * 1000,
  slots: { low: 1, new: 2, neutral: 2, established: 3 },
  concurrent: { low: 2, new: 4, neutral: 4, established: 8 },
  deltas: {
    admitted: 1,
    verified_bad_attestation: -4,
    policy_violation: -2,
    regression: -2,
    check_failure: -1,
    refused_out_of_scope: 0,
    lost_race: 0,
    duplicate: 0,
    send_back_ask_gap: 0,
    self_attestation: 0,
    correction: 0,
  },
} as const;

export type ReviewPolicy = typeof REVIEW_POLICY_V0;
export type OutcomeKind = keyof ReviewPolicy["deltas"];
export type Tier = "low" | "new" | "neutral" | "established";

export const OUTCOME_KINDS = Object.keys(REVIEW_POLICY_V0.deltas) as OutcomeKind[];

export interface QualityEvent {
  readonly key: string;
  readonly canonical: string;
  readonly contributor: string;
  readonly candidate: string;
  readonly objective: string;
  readonly tip: string;
  readonly kind: OutcomeKind;
  // The policy delta for this kind; a correction's own delta. Check failures past the allowance
  // are charged at derivation, not here, so the stored row never depends on its neighbours.
  readonly delta: number;
  readonly reason: string;
  readonly ref: string | null;
  readonly source: "authority";
  readonly policy: string;
  readonly at: string;
}

export interface Standing {
  readonly canonical: string;
  readonly contributor: string;
  readonly score: number;
  readonly tier: Tier;
  readonly slots: number;
  readonly concurrent: number;
  readonly counted: number;
  readonly policy: string;
}

export interface PendingCandidate {
  readonly name: string;
  readonly canonical: string;
  readonly objective: string;
  readonly contributor: string;
  readonly pushedAt: number;
}

// SPEC 3.2: cand--<objective>--<world>--<harness>--<agent>--<session>.
const CANDIDATE = /^cand--([a-z0-9-]+?)--([a-z0-9]+)--([a-z0-9]+)--([a-z0-9-]+)--([a-z0-9]+)$/;
const NAME = /^[a-z0-9-]{1,40}$/;
const OID = /^[0-9a-f]{40}$/;
const REF = /^[a-z0-9-]{1,60}$/;

/** The verified contributor of a candidate: the WORLD field of its name, or null. */
export function contributorOf(candidate: string): string | null {
  return CANDIDATE.exec(candidate)?.[2] ?? null;
}

function objectiveOf(candidate: string): string {
  return CANDIDATE.exec(candidate)?.[1] ?? "";
}

function isOutcomeKind(v: unknown): v is OutcomeKind {
  return typeof v === "string" && Object.hasOwn(REVIEW_POLICY_V0.deltas, v);
}

export type ValidateResult = { ok: true; event: QualityEvent } | { ok: false; error: string };

/** Validates an outcome event as the PA posts it. A contributor-sourced statement is refused. */
export function validateEvent(input: unknown, policy: ReviewPolicy = REVIEW_POLICY_V0): ValidateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "event must be an object" };
  const b = input as Record<string, unknown>;
  if (b.source !== "authority") return { ok: false, error: "source must be authority: only the PA's own outcomes count" };
  if (typeof b.canonical !== "string" || !NAME.test(b.canonical)) return { ok: false, error: "canonical must match [a-z0-9-]{1,40}" };
  if (typeof b.candidate !== "string") return { ok: false, error: "candidate is required" };
  const contributor = contributorOf(b.candidate);
  if (contributor === null) return { ok: false, error: "candidate does not match SPEC 3.2" };
  if (b.contributor !== undefined && b.contributor !== contributor) {
    return { ok: false, error: `contributor must be the candidate's verified world, ${contributor}` };
  }
  if (typeof b.tip !== "string" || !OID.test(b.tip)) return { ok: false, error: "tip must be a 40-hex commit id" };
  if (!isOutcomeKind(b.kind)) return { ok: false, error: `kind must be one of ${OUTCOME_KINDS.join(", ")}` };
  if (typeof b.reason !== "string" || b.reason.length === 0 || b.reason.length > 500) return { ok: false, error: "reason must be 1 to 500 chars" };
  let delta: number = policy.deltas[b.kind];
  let ref: string | null = null;
  if (b.kind === "correction") {
    if (typeof b.ref !== "string" || !REF.test(b.ref)) return { ok: false, error: "a correction needs a ref, [a-z0-9-]{1,60}" };
    if (!Number.isInteger(b.delta) || Math.abs(b.delta as number) > policy.maxCorrection || b.delta === 0) {
      return { ok: false, error: `a correction needs a non-zero integer delta of at most ${policy.maxCorrection}` };
    }
    delta = b.delta as number;
    ref = b.ref;
  }
  const at = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) ? b.at : new Date().toISOString();
  const keyParts = [b.canonical, contributor, b.candidate, b.tip, b.kind];
  if (ref !== null) keyParts.push(ref);
  return {
    ok: true,
    event: {
      key: keyParts.join("|"), canonical: b.canonical, contributor, candidate: b.candidate, objective: objectiveOf(b.candidate),
      tip: b.tip, kind: b.kind, delta, reason: b.reason, ref, source: "authority", policy: policy.version, at,
    },
  };
}

function tierOf(score: number, counted: number, policy: ReviewPolicy): Tier {
  if (score <= policy.lowAt) return "low";
  if (score >= policy.establishedAt) return "established";
  return counted === 0 ? "new" : "neutral";
}

/**
 * Derives one standing from the event log. Duplicate keys count once, and the result does not
 * depend on the log's order, so a restart that re-reads the log reaches the same standing.
 */
export function deriveStanding(
  events: readonly QualityEvent[], canonical: string, contributor: string, policy: ReviewPolicy = REVIEW_POLICY_V0,
): Standing {
  const unique = new Map<string, QualityEvent>();
  for (const e of events) {
    if (e.canonical === canonical && e.contributor === contributor && e.source === "authority" && !unique.has(e.key)) unique.set(e.key, e);
  }
  let raw = 0;
  const failures = new Map<string, number>();
  for (const e of unique.values()) {
    if (e.kind === "check_failure") {
      const seen = (failures.get(e.objective) ?? 0) + 1;
      failures.set(e.objective, seen);
      if (seen > policy.checkFailureAllowance) raw += e.delta;
    } else {
      raw += e.delta;
    }
  }
  const score = Math.min(policy.maxScore, Math.max(policy.minScore, raw));
  const tier = tierOf(score, unique.size, policy);
  return {
    canonical, contributor, score, tier, slots: policy.slots[tier], concurrent: policy.concurrent[tier], counted: unique.size,
    policy: policy.version,
  };
}

/**
 * Maps one authority ruling to an outcome kind, from the check name that leads its reason
 * (scripts/authority.ts). A conflict at merge is a lost race, not a quality failure, and an
 * authority error is the PA's own gap.
 */
export function outcomeFromRuling(verdict: string, reason: string): OutcomeKind {
  if (verdict === "ADMIT") return "admitted";
  const lead = reason.split(":")[0]?.trim() ?? "";
  if (verdict === "REFUSE") {
    if (lead === "scope") return "policy_violation";
    if (lead === "first") return "lost_race";
    return "refused_out_of_scope";
  }
  // A check that ended on anything but a test failure (exit 1) is the sandbox's: a timeout (124),
  // a kill (137), a crash. That is the PA's gap, never the contributor's.
  if (lead === "check") {
    const exit = /\(exit (\d+)\)/.exec(reason)?.[1];
    return exit === undefined || exit === "1" ? "check_failure" : "send_back_ask_gap";
  }
  if (lead === "hidden" || lead === "note") return "check_failure";
  if (reason.startsWith("merge into ")) return "lost_race";
  return "send_back_ask_gap";
}

const TIER_RANK: Record<Tier, number> = { established: 0, new: 1, neutral: 1, low: 2 };

/**
 * Orders pending candidates for review. Candidates for the same (canonical, objective) keep their
 * push order, so standing never decides which candidate wins an objective; it decides only which
 * objective's next candidate the PA reviews first. A head that has waited past the policy's limit
 * goes first, oldest first, so a low standing waits longer and is never starved.
 */
export function orderReviewQueue(
  pending: readonly PendingCandidate[],
  standingOf: (canonical: string, contributor: string) => Standing,
  now: number,
  policy: ReviewPolicy = REVIEW_POLICY_V0,
): PendingCandidate[] {
  const groups = new Map<string, PendingCandidate[]>();
  // A candidate with no recorded push has no age yet: it counts as pushed now, never as starved.
  const aged = pending.map((p) => (p.pushedAt > 0 ? p : { ...p, pushedAt: now }));
  for (const p of aged.sort((a, b) => a.pushedAt - b.pushedAt || a.name.localeCompare(b.name))) {
    const k = `${p.canonical}|${p.objective}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const rank = new Map<string, number>();
  const rankOf = (p: PendingCandidate): number => {
    const k = `${p.canonical}|${p.contributor}`;
    if (!rank.has(k)) rank.set(k, TIER_RANK[standingOf(p.canonical, p.contributor).tier]);
    return rank.get(k) ?? TIER_RANK.new;
  };
  const out: PendingCandidate[] = [];
  for (;;) {
    const heads = [...groups.values()].map((g) => g[0]).filter((h): h is PendingCandidate => h !== undefined);
    if (heads.length === 0) return out;
    const starved = (p: PendingCandidate): boolean => now - p.pushedAt >= policy.maxWaitMs;
    heads.sort((a, b) =>
      Number(starved(b)) - Number(starved(a)) ||
      (starved(a) && starved(b) ? 0 : rankOf(a) - rankOf(b)) ||
      a.pushedAt - b.pushedAt || a.name.localeCompare(b.name));
    const next = heads[0] as PendingCandidate;
    out.push(next);
    groups.get(`${next.canonical}|${next.objective}`)?.shift();
  }
}
