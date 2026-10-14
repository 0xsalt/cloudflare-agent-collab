// Contract tests for the Decision Record (ISSUE-00021, planning SPEC 16.6). Run: bun test tests/
import { describe, expect, test } from "bun:test";
import { ACTIONS, RECORD_KEYS, validateControl, validateRecord, type DecisionClass } from "../src/decisions";

const section = (summary = "ok"): Record<string, unknown> => ({ summary });

function valid(): Record<string, unknown> {
  return {
    decision_requested: section("Approve admitting x"),
    why_now: { summary: "scope", red_criteria: ["reserved"] },
    evidence: section("paths changed"),
    assumptions: section("deliberate"),
    alternatives: { summary: "two", options: [{ name: "waive", summary: "admit" }, { name: "refuse", summary: "keep" }] },
    no_action_baseline: section("refused"),
    recommendation: { summary: "refuse", choice: "refuse" },
    blast_radius: { summary: "medium", level: "medium" },
    cost_tradeoffs: section("review cost"),
    uncertainty: { summary: "none", confidence: 90 },
    reversibility: { summary: "nothing merged", reversal_cost: "low" },
    time_control: { summary: "no rush", urgency: "low", deferral_safe: true, needed_by: "2026-10-14", controls: [...ACTIONS] },
  };
}

// Applies a change to a fresh valid record and returns the first failing path, or null.
function failing(change: (r: Record<string, Record<string, unknown>>) => void, cls: DecisionClass = "red"): string | null {
  const r = valid() as Record<string, Record<string, unknown>>;
  change(r);
  return validateRecord(r, cls);
}

describe("validateRecord", () => {
  test("a complete record passes, in the twelve keys' order", () => {
    expect(validateRecord(valid(), "red")).toBeNull();
    expect(RECORD_KEYS).toHaveLength(12);
  });

  test("a record that is not an object fails at the root", () => {
    expect(validateRecord(null, "red")).toBe("record");
    expect(validateRecord([], "red")).toBe("record");
  });

  test("a missing key, an unknown key and a bad section name their path", () => {
    expect(failing((r) => { delete r.evidence; })).toBe("record.evidence");
    expect(failing((r) => { r.extra = { summary: "x" }; })).toBe("record.extra");
    expect(failing((r) => { r.evidence = "text" as never; })).toBe("record.evidence");
    expect(failing((r) => { r.evidence = { summary: "" }; })).toBe("record.evidence.summary");
    expect(failing((r) => { r.evidence = { summary: "x", detail: 3 }; })).toBe("record.evidence.detail");
    expect(failing((r) => { r.evidence = { summary: "x", refs: "a" }; })).toBe("record.evidence.refs");
    expect(failing((r) => { r.evidence = { summary: "x", refs: ["a", 2] }; })).toBe("record.evidence.refs");
  });

  test("why_now: a red record needs criteria from the list; others may omit them", () => {
    expect(failing((r) => { r.why_now = { summary: "x" }; })).toBe("record.why_now.red_criteria");
    expect(failing((r) => { r.why_now = { summary: "x", red_criteria: [] }; })).toBe("record.why_now.red_criteria");
    expect(failing((r) => { r.why_now = { summary: "x", red_criteria: ["live_substrate", "nonsense"] }; })).toBe("record.why_now.red_criteria");
    expect(failing((r) => { r.why_now = { summary: "x", red_criteria: ["authority_error"] }; })).toBeNull();
    expect(failing((r) => { r.why_now = { summary: "x" }; }, "yellow")).toBeNull();
    expect(failing((r) => { r.why_now = { summary: "x", red_criteria: ["nonsense"] }; }, "green")).toBe("record.why_now.red_criteria");
  });

  test("alternatives need one option with a name and a summary, and the recommendation names one", () => {
    expect(failing((r) => { r.alternatives = { summary: "x", options: [] }; })).toBe("record.alternatives.options");
    expect(failing((r) => { r.alternatives = { summary: "x", options: [{ name: "a" }] }; })).toBe("record.alternatives.options[0].summary");
    expect(failing((r) => { r.recommendation = { summary: "x", choice: "other" }; })).toBe("record.recommendation.choice");
    expect(failing((r) => { r.recommendation = { summary: "x" }; })).toBe("record.recommendation.choice");
  });

  test("uncertainty, blast radius and reversibility take their fixed values", () => {
    expect(failing((r) => { r.uncertainty = { summary: "x", confidence: 101 }; })).toBe("record.uncertainty.confidence");
    expect(failing((r) => { r.uncertainty = { summary: "x", confidence: 1.5 }; })).toBe("record.uncertainty.confidence");
    expect(failing((r) => { r.uncertainty = { summary: "x" }; })).toBeNull();
    expect(failing((r) => { r.blast_radius = { summary: "x", level: "huge" }; })).toBe("record.blast_radius.level");
    expect(failing((r) => { r.blast_radius = { summary: "x" }; })).toBeNull();
    expect(failing((r) => { r.reversibility = { summary: "x" }; })).toBe("record.reversibility.reversal_cost");
    expect(failing((r) => { r.reversibility = { summary: "x", reversal_cost: "none" }; })).toBe("record.reversibility.reversal_cost");
  });

  test("time_control: urgency, deferral_safe, needed_by and controls", () => {
    expect(failing((r) => { r.time_control = { summary: "x", urgency: "now", deferral_safe: true }; })).toBe("record.time_control.urgency");
    expect(failing((r) => { r.time_control = { summary: "x", urgency: "low" }; })).toBe("record.time_control.deferral_safe");
    expect(failing((r) => { r.time_control = { summary: "x", urgency: "low", deferral_safe: "yes" }; })).toBe("record.time_control.deferral_safe");
    expect(failing((r) => { r.time_control = { summary: "x", urgency: "low", deferral_safe: true, needed_by: "soon" }; })).toBe("record.time_control.needed_by");
    expect(failing((r) => { r.time_control = { summary: "x", urgency: "low", deferral_safe: true, controls: ["approve", "delete"] }; })).toBe("record.time_control.controls");
    expect(failing((r) => { r.time_control = { summary: "x", urgency: "high", deferral_safe: false }; })).toBeNull();
  });

  test("a record over 32 KB is refused", () => {
    expect(failing((r) => { r.evidence = { summary: "x", detail: "y".repeat(40_000) }; })).toBe("record");
  });
});

describe("validateControl", () => {
  const record = valid();

  test("an action alone is accepted for the eight actions that need no choice", () => {
    for (const action of ACTIONS.filter((a) => a !== "choose_alternative")) expect(validateControl({ action }, record)).toEqual({ ok: true, action, choice: null, note: null });
  });

  test("choose_alternative needs a choice that is one of the options", () => {
    expect(validateControl({ action: "choose_alternative" }, record)).toEqual({ ok: false, error: "choice is required for choose_alternative" });
    expect(validateControl({ action: "choose_alternative", choice: "other" }, record)).toEqual({ ok: false, error: "choice must be one of the record's options" });
    expect(validateControl({ action: "choose_alternative", choice: "waive", note: "ok" }, record)).toEqual({ ok: true, action: "choose_alternative", choice: "waive", note: "ok" });
  });

  test("an unknown action, a long note and a stray choice are refused", () => {
    expect(validateControl({ action: "delete" }, record)).toEqual({ ok: false, error: `action must be one of ${ACTIONS.join(", ")}` });
    expect(validateControl({ action: "approve", note: "n".repeat(501) }, record)).toEqual({ ok: false, error: "note must be a string of at most 500 characters" });
    expect(validateControl({ action: "approve", choice: "waive" }, record)).toEqual({ ok: false, error: "choice is only for choose_alternative" });
    expect(validateControl(null, record)).toEqual({ ok: false, error: "body must be a JSON object" });
  });
});
