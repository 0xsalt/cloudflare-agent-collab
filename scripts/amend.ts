// The spec amendment loop's pure rules (ISSUE-00015, planning SPEC 14.1 step 11; CONTRACT.md
// "Amending the spec"). A candidate on the spec canonical proposes an amendment: it only ADDS lines
// to SPEC.md or CONTRACT.md, and its note cites the recorded verdict where the gap was met. The
// authority (scripts/authority.ts) runs these rules, then replays a cited SEND_BACK to prove the
// judge still refuses that shape, so the amended text says what the judge enforces.

export const AMEND_PREFIX = "amend-";
export const AMENDABLE = ["SPEC.md", "CONTRACT.md"] as const;
export const MAX_ADDED_LINES = 40;

export interface Judged {
  readonly result: "pass" | "fail";
  readonly detail: string;
}

/** Scope: only SPEC.md and CONTRACT.md may change, and at least one must. */
export function judgeAmendScope(changed: readonly string[]): Judged & { outside: string[] } {
  const outside = changed.filter((p) => !(AMENDABLE as readonly string[]).includes(p));
  if (outside.length > 0) return { result: "fail", detail: `changes outside SPEC.md and CONTRACT.md: ${outside.join(", ")}`, outside };
  if (changed.length === 0) return { result: "fail", detail: "changes nothing", outside };
  return { result: "pass", detail: `changes ${changed.join(" and ")} only`, outside };
}

/**
 * Additions only: no line removed or rewritten, at most MAX_ADDED_LINES added, and no added heading
 * at levels 1 to 3 or naming an ask, so sections, their numbers and the ask ledger stay stable.
 * `diff` is `git diff -U0 <base> HEAD -- SPEC.md CONTRACT.md`.
 */
export function judgeAdditions(diff: string): Judged {
  const added: string[] = [];
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed++;
  }
  if (removed > 0) return { result: "fail", detail: `removes or rewrites ${removed} line(s); an amendment only adds lines` };
  if (added.length === 0) return { result: "fail", detail: "adds no line" };
  if (added.length > MAX_ADDED_LINES) return { result: "fail", detail: `adds ${added.length} lines; at most ${MAX_ADDED_LINES}` };
  const heading = added.find((l) => /^#{1,3}\s/.test(l) || /^#+\s+Ask:/.test(l));
  if (heading !== undefined) return { result: "fail", detail: `adds a section or ask heading (${heading.slice(0, 60)}); use #### or plain lines` };
  return { result: "pass", detail: `adds ${added.length} line(s), removes none` };
}

export interface CitableVerdict {
  readonly candidate: string;
  readonly canonical: string;
  readonly objective: string;
  readonly verdict: string;
  readonly commit: string;
  readonly reason?: string;
  readonly ruled_at: string;
}

/** The note's `cites` must name a recorded verdict on an api or site candidate: {candidate, commit}. */
export function resolveCite(cites: unknown, verdicts: readonly CitableVerdict[]): { verdict: CitableVerdict | null; problem: string | null } {
  if (typeof cites !== "object" || cites === null) return { verdict: null, problem: "the note has no cites object {candidate, commit}" };
  const { candidate, commit } = cites as { candidate?: unknown; commit?: unknown };
  if (typeof candidate !== "string" || typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    return { verdict: null, problem: "cites needs candidate (a repo name) and commit (40 hex characters)" };
  }
  const found = verdicts.filter((v) => v.candidate === candidate && v.commit === commit && (v.canonical === "api" || v.canonical === "site"));
  if (found.length === 0) return { verdict: null, problem: `no recorded verdict on ${candidate} at ${commit.slice(0, 10)}` };
  return { verdict: found[found.length - 1] ?? null, problem: null };
}

/** Which judge a cited verdict is replayed with: a SEND_BACK from the hidden or public check. */
export function replayKind(v: CitableVerdict): "hidden" | "check" | null {
  if (v.verdict !== "SEND_BACK") return null;
  if ((v.reason ?? "").startsWith("hidden:")) return "hidden";
  if ((v.reason ?? "").startsWith("check:")) return "check";
  return null;
}
