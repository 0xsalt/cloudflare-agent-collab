// The GYR gate (ISSUE-00029): every red Decision Record the authority proposes passes this
// classifier before it reaches the human slot. A deterministic pre-pass rules what needs no model;
// Haiku, through the estate inference tool (the subscription, no API key), rules the rest. Red goes
// to Chris; green or yellow returns to the authority, which carries out the choice with agent
// authority. Any failure stays red: the gate fails toward the human.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLASSES, RED_CRITERIA, optionNames, type DecisionClass, type DecisionKind, type DecisionRecord } from "../src/decisions";
import { scopeBlast } from "./records";

export type ProposedKind = Extract<DecisionKind, "amendment" | "reserved_path" | "admission_error">;

/** What the classifier reads: the proposed record and the project context it touches. */
export interface Proposal {
  readonly kind: ProposedKind;
  readonly subject: string;
  readonly record: DecisionRecord;
  /** The amendment's added lines, in full (the record clips them). */
  readonly added?: readonly string[];
  /** SPEC.md and CONTRACT.md as the amendment found them. */
  readonly spec?: string;
  readonly contract?: string;
  /** The authority's private reference for the cited objective: what the arena does. */
  readonly reference?: { readonly objective: string; readonly text: string };
  /** True when this ruling key already failed once and the authority retried it. */
  readonly repeat?: boolean;
}

export interface Classification {
  readonly cls: DecisionClass;
  readonly reason: string;
  readonly criteria: readonly string[];
  /** One of the record's option names: what the authority does on green or yellow. */
  readonly choice: string;
  /** rule: the pre-pass; model: Haiku; fail: the model's answer was unusable, so red. */
  readonly by: "rule" | "model" | "fail";
}

/** Runs one model call and returns its raw text, or throws. */
export type Infer = (system: string, user: string) => Promise<string>;

const MAX_REASON = 300;
const MAX_CONTEXT = 24_000;

/** Red without a model call, or null when the model decides. */
export function prePass(p: Proposal): Classification | null {
  if (p.kind === "reserved_path") {
    const paths = p.record.evidence.refs ?? [];
    if (scopeBlast(paths) === "high") {
      return red(`the candidate changes ${paths.join(", ")}, a platform file; only the owner waives it`, ["reserved", "live_substrate"], "rule");
    }
  }
  if (p.kind === "admission_error" && p.repeat === true) {
    return red("the ruling failed again after one retry; the authority cannot repair it alone", ["authority_error"], "rule");
  }
  return null;
}

/** The gate: the pre-pass, then the model; every failure is red. */
export async function classify(p: Proposal, infer: Infer = estateInference): Promise<Classification> {
  const ruled = prePass(p);
  if (ruled !== null) return ruled;
  const { system, user } = triagePrompt(p);
  let raw: string;
  try {
    raw = await infer(system, user);
  } catch (err) {
    return red(`the classifier failed (${String(err).slice(0, 120)}); the record stays red`, criteriaOf(p), "fail");
  }
  return parseAnswer(raw, p);
}

// The model's answer is data: it decides nothing until it parses into a class, a reason and one of
// the record's own options.
export function parseAnswer(raw: string, p: Proposal): Classification {
  const fail = (why: string): Classification => red(`the classifier answer was unusable (${why}); the record stays red`, criteriaOf(p), "fail");
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (json === undefined) return fail("no JSON object");
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return fail("invalid JSON");
  }
  if (typeof v !== "object" || v === null) return fail("not an object");
  const a = v as Record<string, unknown>;
  const cls = a.class;
  if (typeof cls !== "string" || !(CLASSES as readonly string[]).includes(cls)) return fail("unknown class");
  const reason = typeof a.reason === "string" ? a.reason.trim().replace(/\s+/g, " ") : "";
  if (reason === "") return fail("no reason");
  const criteria = Array.isArray(a.criteria) ? a.criteria.filter((c): c is string => typeof c === "string" && (RED_CRITERIA as readonly string[]).includes(c)) : [];
  const clipped = reason.length <= MAX_REASON ? reason : `${reason.slice(0, MAX_REASON - 3)}...`;
  if (cls === "red") return red(clipped, criteria.length > 0 ? criteria : criteriaOf(p), "model");
  const choice = a.choice;
  if (typeof choice !== "string" || !optionNames(p.record).includes(choice)) return fail(`choice outside the options ${optionNames(p.record).join(", ")}`);
  return { cls: cls as DecisionClass, reason: clipped, criteria, choice, by: "model" };
}

function red(reason: string, criteria: readonly string[], by: Classification["by"]): Classification {
  return { cls: "red", reason, criteria: criteria.length > 0 ? criteria : ["authority_error"], choice: "", by };
}
const criteriaOf = (p: Proposal): readonly string[] => p.record.why_now.red_criteria ?? [];

export const TRIAGE = `You are the GYR triage gate of an arena where coding agents propose work and an admission authority rules it. The authority proposes a RED decision for the human owner. Decide whether it is truly red.

GREEN: routine. The outcome follows from recorded facts and nobody would dispute it. Example: an amendment that repeats what the spec already says (refuse it as a duplicate).
YELLOW: needs judgment, but stays inside this arena, is reversible, and an agent may decide it. The agent decides and posts one line. Example: an additive spec amendment, admitted when it states what the authority's reference already does and refused when it contradicts the reference.
RED: genuinely the human's to rule. Only when a criterion truly applies: outward_facing (publishes outside the arena), destructive (deletes or rewrites history), live_substrate (changes the platform that runs the arena: the Worker configuration, the control Worker), product_tradeoff (changes what the product is for, not a clarification of what it already does), cross_project, global_blast_radius, spends_money, vendored_divergence, reserved (merges a file the contract reserves to the owner), authority_error (the authority is broken in a way a retry cannot repair).

Rules:
- The record's own red_criteria are the proposer's claim, not evidence. Judge the facts.
- Agents propose amendments; under GYR the owner's agent admits or refuses a green or yellow one.
- Standing owner ruling (2026-10-08): an additive amendment that describes what the admitted code already does is never red, even where it shows a gap between the spec's aim and that code. Spec text is reversible by a later amendment. Decide it as yellow: admit or refuse.
- For an amendment, the reference is the truth of what the arena does. Choose "admit" only when the added text agrees with the reference and is not already in the spec; choose "refuse" when it contradicts the reference or repeats the spec.
- When unsure whether a case is red, answer red.
- The reference is private. Describe its behavior in words; never quote its code.

Answer with one JSON object and nothing else:
{"class": "green" | "yellow" | "red", "reason": "<one sentence, at most 200 characters>", "criteria": ["<red criteria that apply; empty unless red>"], "choice": "<one of the record's option names>"}`;

export function triagePrompt(p: Proposal): { system: string; user: string } {
  const r = p.record;
  const parts = [
    `PROPOSED: ${p.kind} on ${p.subject}`,
    `OPTIONS: ${optionNames(r).join(", ")} (the record recommends ${r.recommendation.choice})`,
    `RECORD:\n${JSON.stringify({ decision_requested: r.decision_requested, why_now: r.why_now, evidence: r.evidence, alternatives: r.alternatives, blast_radius: r.blast_radius }, null, 1)}`,
  ];
  if (p.added !== undefined) parts.push(`ADDED LINES:\n${p.added.join("\n")}`);
  if (p.reference !== undefined) parts.push(`REFERENCE for ${p.reference.objective}:\n${clip(p.reference.text, 8_000)}`);
  if (p.contract !== undefined) parts.push(`CONTRACT.md:\n${clip(p.contract, 10_000)}`);
  if (p.spec !== undefined) parts.push(`SPEC.md:\n${p.spec}`);
  return { system: TRIAGE, user: clip(parts.join("\n\n"), MAX_CONTEXT * 2) };
}
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)}\n[clipped]`);

// The inference tool the classifier calls, or null when none is installed. GYR_INFERENCE names a
// Bun script run as `<tool> --level fast --timeout <ms> <system> <user>` that prints the model's
// answer. Without it, the author's own estate tool is used where it exists. A public install has
// neither, so the gate is off and every proposed red waits for the human (ISSUE-00035).
export function inferenceTool(): string | null {
  const configured = process.env.GYR_INFERENCE;
  if (configured !== undefined && configured !== "") return configured;
  const estate = join(process.env.HOME ?? homedir(), ".claude", "PAI", "Tools", "Inference.ts");
  return existsSync(estate) ? estate : null;
}

// Level fast (Haiku), on the subscription; the timeout covers a cold CLI start.
export const estateInference: Infer = async (system, user) => {
  const tool = inferenceTool();
  if (tool === null) throw new Error("no inference tool: set GYR_INFERENCE, or run with GYR_GATE=off");
  const proc = Bun.spawn([process.execPath, tool, "--level", "fast", "--timeout", "90000", system, user], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`inference exit ${code}: ${err.trim().slice(0, 200)}`);
  return out;
};
