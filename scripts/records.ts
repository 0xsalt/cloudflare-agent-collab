// The Decision Records the admission authority writes (ISSUE-00021, planning SPEC 16.6). The
// authority is the writer, so completeness is mechanical: each builder fills all twelve fields and
// tests/records.test.ts checks every output against the Worker's own validation.

import { ACTIONS, type DecisionRecord } from "../src/decisions";

const MAX_SUMMARY = 480;
const MAX_REFS = 20;
const MAX_REF = 200;

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 3)}...`);
const nonEmpty = (s: string, fallback: string): string => (s.trim().length > 0 ? s : fallback);

// "view-trace slot a1" for a candidate name; the name itself when it is not one.
export function who(candidate: string): string {
  const p = candidate.split("--");
  return p.length === 6 && p[0] === "cand" ? `${p[1]} slot ${p[4]}` : candidate;
}

// SPEC 16.6: a path that changes the platform itself is a high blast radius; anything else the
// contract reserves is medium.
export function scopeBlast(paths: readonly string[]): "medium" | "high" {
  return paths.some((p) => p === "wrangler.jsonc" || (p.startsWith("src/") && !p.startsWith("src/series/"))) ? "high" : "medium";
}

export function reservedPathRecord(c: { candidate: string; askFile: string; paths: readonly string[]; reason: string }): DecisionRecord {
  const listed = c.paths.slice(0, MAX_REFS).map((p) => clip(p, MAX_REF));
  const more = c.paths.length - listed.length;
  const named = c.paths.join(", ");
  const level = scopeBlast(c.paths);
  return {
    decision_requested: { summary: clip(`Keep the refusal of ${who(c.candidate)}?`, MAX_SUMMARY) },
    why_now: { summary: clip(`The candidate changed ${named}, which the contract reserves. Only the owner can waive a reserved path.`, MAX_SUMMARY), red_criteria: ["reserved"] },
    evidence: {
      summary: clip(`${c.paths.length === 1 ? "One path" : `${c.paths.length} paths`} changed outside ${c.askFile}: ${named}.`, MAX_SUMMARY),
      detail: clip(`Candidate ${c.candidate}. The verdict reason: ${c.reason}.${more > 0 ? ` The record omits ${more} more paths.` : ""}`, 1_000),
      refs: listed,
    },
    assumptions: { summary: "The extra change could be deliberate and belong to this ask." },
    alternatives: {
      summary: "Keep the refusal, or waive the reserved paths and run the checks.",
      options: [
        { name: "refuse", summary: "Keep the refusal. The ask stays open for another candidate." },
        { name: "waive", summary: "Waive the reserved paths and run the checks. A pass merges the paths into the canonical." },
      ],
    },
    no_action_baseline: { summary: "The refusal stands, and the ask stays open for another candidate." },
    recommendation: { summary: "Keep the refusal. A candidate changes one file, and the contract reserves the rest.", choice: "refuse" },
    blast_radius: { summary: clip(`${level === "high" ? "Do not waive a platform file." : "Waive with care."} A waived path reaches the canonical on admit: ${named}.`, MAX_SUMMARY), level },
    cost_tradeoffs: { summary: "A waiver admits a reserved file. A refusal costs the candidate one resubmission." },
    uncertainty: { summary: "No material uncertainty is known." },
    reversibility: { summary: "Nothing is merged yet, so the owner can still change either choice.", reversal_cost: "low" },
    time_control: { summary: "No deadline applies. The ask stays open meanwhile.", urgency: "low", deferral_safe: true, controls: [...ACTIONS] },
  };
}

// A spec amendment that passed every check (ISSUE-00015). The owner admits it or not: agents propose
// amendments, the owner admits them (planning SPEC 7). `key` finds this record again for the tip.
export function amendmentRecord(c: {
  candidate: string; key: string; added: readonly string[]; files: readonly string[]; cited: string; replay: string; reason: string;
}): DecisionRecord {
  const objective = c.candidate.split("--")[1] ?? c.candidate;
  const listed = c.added.filter((l) => l.trim() !== "").slice(0, MAX_REFS - 2).map((l) => clip(l, MAX_REF));
  return {
    decision_requested: { summary: clip(`Admit the amendment ${objective} to ${c.files.join(" and ")}?`, MAX_SUMMARY) },
    why_now: { summary: "Every check passed. The amendment changes the spec text that every later run reads.", red_criteria: ["product_tradeoff"] },
    evidence: {
      summary: clip(`The amendment adds ${c.added.length} lines and removes none. It cites ${c.cited}. The replay result: ${c.replay}.`, MAX_SUMMARY),
      detail: clip(`${c.added.join("\n")}\n\nThe submitter's reason: ${c.reason}`, 1_000),
      refs: [clip(`ruling key: ${c.key}`, MAX_REF), clip(`cites: ${c.cited}`, MAX_REF), ...listed],
    },
    assumptions: { summary: "The added text states what the arena already does." },
    alternatives: {
      summary: "Admit the amendment, or refuse the amendment.",
      options: [
        { name: "admit", summary: "Admit the amendment. Spec merges the text, and every later run reads it." },
        { name: "refuse", summary: "Refuse the amendment. The question stays open for another amendment." },
      ],
    },
    no_action_baseline: { summary: "The candidate waits without a ruling, and the spec stays unchanged." },
    recommendation: { summary: "Admit the amendment. It only adds lines, and the replay measured its cited failure.", choice: "admit" },
    blast_radius: { summary: "The spec text changes for every later candidate. No code changes.", level: "medium" },
    cost_tradeoffs: { summary: "An admit fixes the text for every later run. A refusal leaves the question open." },
    uncertainty: { summary: "Only a human read confirms that the text matches the arena's intent." },
    reversibility: { summary: "An admitted amendment stays in the spec history. A correction needs a new publish.", reversal_cost: "medium" },
    time_control: { summary: "No deadline applies. The candidate waits meanwhile.", urgency: "low", deferral_safe: true, controls: [...ACTIONS] },
  };
}

// `key` identifies the failed ruling so the authority can find this record again and never post a
// second one while it is open.
export function admissionErrorRecord(c: { candidate: string; key: string; error: string }): DecisionRecord {
  return {
    decision_requested: { summary: clip(`Retry the ruling on ${who(c.candidate)}?`, MAX_SUMMARY) },
    why_now: { summary: "The authority failed while it ruled. The candidate has no ruling, and nobody blames it.", red_criteria: ["authority_error"] },
    evidence: { summary: clip(nonEmpty(c.error, "The authority reported no error text."), 500), detail: clip(`Candidate ${c.candidate}.`, 1_000), refs: [clip(`ruling key: ${c.key}`, MAX_REF)] },
    assumptions: { summary: "The failure is transient, or the authority is repaired now." },
    alternatives: {
      summary: "Retry the ruling, send the candidate back with the error, or leave the candidate unruled.",
      options: [
        { name: "retry", summary: "Retry the ruling. The candidate did nothing wrong." },
        { name: "send_back", summary: "Send the candidate back. The error becomes the reason." },
        { name: "stop", summary: "Leave the candidate unruled. Repair the authority first." },
      ],
    },
    no_action_baseline: { summary: "The candidate stays without a ruling until the authority restarts." },
    recommendation: { summary: "Retry the ruling. The candidate did nothing wrong.", choice: "retry" },
    blast_radius: { summary: "One candidate waits for its ruling.", level: "low" },
    cost_tradeoffs: { summary: "A retry costs one admission run. A send-back blames the candidate for the authority's failure." },
    uncertainty: { summary: "The error text is the only evidence that a retry can succeed." },
    reversibility: { summary: "A retry merges nothing. A send-back is a ruling that the candidate can answer.", reversal_cost: "low" },
    time_control: { summary: "The candidate waits. Nothing else is blocked.", urgency: "medium", deferral_safe: true, controls: [...ACTIONS] },
  };
}

// The GYR gate's verdict on a proposed red (ISSUE-00029), as evidence refs: the board counts
// "gyr: " refs to tell a classified red from one that never passed the gate.
export const GYR_PREFIX = "gyr: ";
export function gyrRef(c: { cls: string; by: string; reason: string }): string {
  return clip(`${GYR_PREFIX}${c.cls} by ${c.by}: ${c.reason}`, MAX_REF);
}
export const PROPOSED_PREFIX = "proposed: ";

/** A red record that stays red: the same record, with the classifier's verdict in its evidence. */
export function escalatedRecord(r: DecisionRecord, c: { cls: string; by: string; reason: string }): DecisionRecord {
  const refs = r.evidence.refs ?? [];
  const key = refs.filter((x) => x.startsWith("ruling key: "));
  const rest = refs.filter((x) => !x.startsWith("ruling key: "));
  return { ...r, evidence: { ...r.evidence, refs: [...key, gyrRef(c), ...rest].slice(0, MAX_REFS) } };
}

/** A proposed red the classifier routed to green or yellow, carried out by the authority. */
export function routedRecord(r: DecisionRecord, kind: string, c: { cls: string; by: string; reason: string; choice: string }): DecisionRecord {
  const refs = r.evidence.refs ?? [];
  const key = refs.filter((x) => x.startsWith("ruling key: "));
  const rest = refs.filter((x) => !x.startsWith("ruling key: "));
  const option = r.alternatives.options.find((o) => o.name === c.choice);
  return {
    ...r,
    decision_requested: { summary: clip(`${r.decision_requested.summary} The authority chose ${c.choice} under GYR ${c.cls}.`, MAX_SUMMARY) },
    why_now: { summary: clip(`GYR ${c.cls}: ${c.reason}`, MAX_SUMMARY) },
    evidence: { ...r.evidence, refs: [...key, `${PROPOSED_PREFIX}${kind}`, gyrRef(c), ...rest].slice(0, MAX_REFS) },
    recommendation: { summary: clip(option?.summary ?? c.choice, MAX_SUMMARY), choice: c.choice },
    time_control: { summary: "No decision is waiting. The authority carried it out.", urgency: "low", deferral_safe: true },
  };
}

// A SEND_BACK or an ADMIT is routine: the record is short and carries no controls.
function routine(requested: string, choice: string, option: string, why: string): DecisionRecord {
  return {
    decision_requested: { summary: clip(requested, MAX_SUMMARY) },
    why_now: { summary: why },
    evidence: { summary: clip(requested, MAX_SUMMARY) },
    assumptions: { summary: "None; the authority's checks decided." },
    alternatives: { summary: option, options: [{ name: choice, summary: option }] },
    no_action_baseline: { summary: "The same ruling stands." },
    recommendation: { summary: clip(option, MAX_SUMMARY), choice },
    blast_radius: { summary: "One candidate.", level: "low" },
    cost_tradeoffs: { summary: "None beyond the ruling itself." },
    uncertainty: { summary: "No material uncertainty identified." },
    reversibility: { summary: "A new push earns a new ruling.", reversal_cost: "low" },
    time_control: { summary: "No decision is waiting.", urgency: "low", deferral_safe: true },
  };
}

export function sendBackRecord(c: { candidate: string; reason: string }): DecisionRecord {
  return routine(`${who(c.candidate)} was sent back: ${c.reason}`, "send_back", "Sent back to the submitter to fix.", "A SEND_BACK is routine; the submitter answers it.");
}

export function admitRecord(c: { candidate: string; tag: string | null }): DecisionRecord {
  return routine(`${who(c.candidate)} was admitted${c.tag === null ? "" : ` as ${c.tag}`}`, "admit", "Merged into the canonical.", "An ADMIT is recorded, not surfaced.");
}
