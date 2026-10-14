// The Decision Record (ISSUE-00021, planning SPEC 16.6, schema decision-record/1): the twelve-field
// brief the authority writes when it needs a human, and the control a human answers it with.
// Validation lives here so the Worker and the tests share one definition.

export const SCHEMA = "decision-record/1";

export const RECORD_KEYS = [
  "decision_requested", "why_now", "evidence", "assumptions", "alternatives", "no_action_baseline",
  "recommendation", "blast_radius", "cost_tradeoffs", "uncertainty", "reversibility", "time_control",
] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];

export const CLASSES = ["red", "yellow", "green"] as const;
export type DecisionClass = (typeof CLASSES)[number];

// Each kind belongs to one class: a reserved path or an authority error needs a human (red), a
// SEND_BACK is one feed line (yellow), an ADMIT is recorded (green).
export const KIND_CLASS = {
  reserved_path: "red",
  admission_error: "red",
  // A spec amendment that passed every check waits for the owner (ISSUE-00015, AMEND_GATE human).
  amendment: "red",
  send_back: "yellow",
  admit: "green",
  // A proposed red the GYR classifier routed back to the authority, which carried it out
  // (ISSUE-00029). The record names the proposed kind and the classifier's reason.
  routed_yellow: "yellow",
  routed_green: "green",
} as const satisfies Record<string, DecisionClass>;
export type DecisionKind = keyof typeof KIND_CLASS;

export const RED_CRITERIA = [
  "outward_facing", "destructive", "live_substrate", "product_tradeoff", "cross_project",
  "global_blast_radius", "spends_money", "vendored_divergence", "reserved", "authority_error",
] as const;

export const ACTIONS = [
  "approve", "choose_alternative", "request_evidence", "challenge_assumption", "request_options",
  "modify_redirect", "defer", "reject", "stop",
] as const;
export type DecisionAction = (typeof ACTIONS)[number];

const LEVELS = ["low", "medium", "high"] as const;
const MAX_RECORD_BYTES = 32_768;
const MAX_SUMMARY = 500;
const MAX_DETAIL = 4_000;
const MAX_REFS = 20;
const MAX_REF = 200;
const MAX_NOTE = 500;

type Level = (typeof LEVELS)[number];
export interface Section { summary: string; detail?: string; refs?: string[] }
// The shape validateRecord guarantees. It names no `unknown`, so a Durable Object can return it over RPC.
export interface DecisionRecord {
  decision_requested: Section;
  why_now: Section & { red_criteria?: string[] };
  evidence: Section;
  assumptions: Section;
  alternatives: Section & { options: { name: string; summary: string }[] };
  no_action_baseline: Section;
  recommendation: Section & { choice: string };
  blast_radius: Section & { level?: Level };
  cost_tradeoffs: Section;
  uncertainty: Section & { confidence?: number };
  reversibility: Section & { reversal_cost: Level };
  time_control: Section & { urgency: Level; deferral_safe: boolean; needed_by?: string; controls?: string[] };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

// Returns the path of the first failing field, or null when the record is valid.
export function validateRecord(record: unknown, cls: DecisionClass): string | null {
  if (!isObj(record)) return "record";
  if (JSON.stringify(record).length > MAX_RECORD_BYTES) return "record";
  for (const key of RECORD_KEYS) {
    const bad = validateSection(key, record[key], cls);
    if (bad !== null) return bad;
  }
  const badChoice = validateChoice(record);
  if (badChoice !== null) return badChoice;
  const unknownKey = Object.keys(record).find((k) => !(RECORD_KEYS as readonly string[]).includes(k));
  return unknownKey === undefined ? null : `record.${unknownKey}`;
}

function validateSection(key: RecordKey, value: unknown, cls: DecisionClass): string | null {
  const path = `record.${key}`;
  if (!isObj(value)) return path;
  if (!isText(value.summary, MAX_SUMMARY)) return `${path}.summary`;
  if (value.detail !== undefined && !(typeof value.detail === "string" && value.detail.length <= MAX_DETAIL)) return `${path}.detail`;
  if (value.refs !== undefined && !(Array.isArray(value.refs) && value.refs.length <= MAX_REFS && value.refs.every((r) => isText(r, MAX_REF)))) return `${path}.refs`;
  return validateExtras(key, value, cls, path);
}

// The fields only some sections carry.
function validateExtras(key: RecordKey, v: Obj, cls: DecisionClass, path: string): string | null {
  switch (key) {
    case "why_now": {
      const criteria = v.red_criteria;
      if (criteria === undefined && cls !== "red") return null;
      const ok = Array.isArray(criteria) && criteria.every((c) => oneOf(RED_CRITERIA, c)) && (cls !== "red" || criteria.length > 0);
      return ok ? null : `${path}.red_criteria`;
    }
    case "alternatives": {
      const options = v.options;
      if (!Array.isArray(options) || options.length === 0) return `${path}.options`;
      for (const [i, o] of options.entries()) {
        if (!isObj(o) || !isText(o.name, 60)) return `${path}.options[${i}].name`;
        if (!isText(o.summary, MAX_SUMMARY)) return `${path}.options[${i}].summary`;
      }
      return null;
    }
    case "recommendation":
      return null;
    case "uncertainty":
      return v.confidence === undefined || (typeof v.confidence === "number" && Number.isInteger(v.confidence) && v.confidence >= 0 && v.confidence <= 100) ? null : `${path}.confidence`;
    case "blast_radius":
      return v.level === undefined || oneOf(LEVELS, v.level) ? null : `${path}.level`;
    case "reversibility":
      return oneOf(LEVELS, v.reversal_cost) ? null : `${path}.reversal_cost`;
    case "time_control": {
      if (!oneOf(LEVELS, v.urgency)) return `${path}.urgency`;
      if (typeof v.deferral_safe !== "boolean") return `${path}.deferral_safe`;
      if (v.needed_by !== undefined && !(typeof v.needed_by === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.needed_by) && !Number.isNaN(Date.parse(v.needed_by)))) return `${path}.needed_by`;
      if (v.controls !== undefined && !(Array.isArray(v.controls) && v.controls.every((c) => oneOf(ACTIONS, c)))) return `${path}.controls`;
      return null;
    }
    default:
      return null;
  }
}

// The recommendation's choice is checked against the options after both sections are known valid.
export function validateChoice(record: Obj): string | null {
  const names = optionNames(record);
  const choice = isObj(record.recommendation) ? record.recommendation.choice : undefined;
  return typeof choice === "string" && names.includes(choice) ? null : "record.recommendation.choice";
}

export function optionNames(record: unknown): string[] {
  const options = isObj(record) && isObj(record.alternatives) && Array.isArray(record.alternatives.options) ? record.alternatives.options : [];
  return options.flatMap((o) => (isObj(o) && typeof o.name === "string" ? [o.name] : []));
}

export type ControlResult =
  | { ok: true; action: DecisionAction; choice: string | null; note: string | null }
  | { ok: false; error: string };

// A human's answer to an open red record. `record` supplies the option names a choice may take.
export function validateControl(body: unknown, record: unknown): ControlResult {
  if (!isObj(body)) return { ok: false, error: "body must be a JSON object" };
  if (!oneOf(ACTIONS, body.action)) return { ok: false, error: `action must be one of ${ACTIONS.join(", ")}` };
  const action = body.action;
  if (body.note !== undefined && !(typeof body.note === "string" && body.note.length <= MAX_NOTE)) return { ok: false, error: `note must be a string of at most ${MAX_NOTE} characters` };
  const note = typeof body.note === "string" && body.note.length > 0 ? body.note : null;
  if (action !== "choose_alternative") {
    return body.choice === undefined ? { ok: true, action, choice: null, note } : { ok: false, error: "choice is only for choose_alternative" };
  }
  if (body.choice === undefined) return { ok: false, error: "choice is required for choose_alternative" };
  if (typeof body.choice !== "string" || !optionNames(record).includes(body.choice)) return { ok: false, error: "choice must be one of the record's options" };
  return { ok: true, action, choice: body.choice, note };
}

export const isDecisionClass = (v: unknown): v is DecisionClass => oneOf(CLASSES, v);
export const isDecisionKind = (v: unknown): v is DecisionKind => typeof v === "string" && Object.hasOwn(KIND_CLASS, v);

// The stored record keeps Chris's order, whatever order the caller sent. Call it only on a record
// for which validateRecord returned null: that check is what makes the cast true.
export function orderRecord(record: unknown): DecisionRecord {
  return Object.fromEntries(RECORD_KEYS.map((k) => [k, isObj(record) ? record[k] : undefined])) as unknown as DecisionRecord;
}
