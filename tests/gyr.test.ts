// The GYR gate (ISSUE-00029) with a stubbed model: the pre-pass, every path that fails toward red,
// and the records the authority posts for each outcome. The live model runs in scripts/gyr-eval.ts.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { classify, inferenceTool, parseAnswer, triagePrompt, type Proposal } from "../scripts/gyr";
import { escalatedRecord, routedRecord } from "../scripts/records";
import { KIND_CLASS, validateRecord, type DecisionRecord } from "../src/decisions";

interface Fixture { id: number; kind: Proposal["kind"]; subject: string; record: DecisionRecord; expected: { cls: string; choice: string } }
const { fixtures } = (await Bun.file(join(import.meta.dir, "fixtures", "gyr-run4a.json")).json()) as { fixtures: Fixture[] };
const fx = (id: number): Fixture => {
  const f = fixtures.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};
const proposal = (id: number, extra: Partial<Proposal> = {}): Proposal => ({ kind: fx(id).kind, subject: fx(id).subject, record: fx(id).record, ...extra });
const never = async (): Promise<string> => {
  throw new Error("the model must not be called");
};
const answer = (v: unknown) => async (): Promise<string> => `Here you go:\n${JSON.stringify(v)}\n`;

test("the fixtures hold the ten run-4a decisions", () => {
  expect(fixtures.map((f) => f.id)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(fixtures.filter((f) => f.expected.cls === "red").map((f) => f.id)).toEqual([1, 2]);
});

test("decisions 1 and 2 (wrangler.jsonc) are red by the pre-pass, with no model call", async () => {
  for (const id of [1, 2]) {
    const c = await classify(proposal(id), never);
    expect(c.cls).toBe("red");
    expect(c.by).toBe("rule");
    expect(c.criteria).toContain("reserved");
  }
});

test("a second authority error on one key is red with no model call", async () => {
  const p: Proposal = { ...proposal(1), kind: "admission_error", repeat: true };
  expect(await classify(p, never)).toMatchObject({ cls: "red", by: "rule", criteria: ["authority_error"] });
});

test("an amendment goes to the model, and its green or yellow answer carries the choice", async () => {
  const c = await classify(proposal(6), answer({ class: "yellow", reason: "matches the reference", criteria: [], choice: "admit" }));
  expect(c).toEqual({ cls: "yellow", reason: "matches the reference", criteria: [], choice: "admit", by: "model" });
});

test("every unusable model answer stays red", async () => {
  const p = proposal(5);
  const fails = [
    async (): Promise<string> => { throw new Error("timeout"); },
    async (): Promise<string> => "I think this is fine.",
    async (): Promise<string> => "{not json}",
    answer({ class: "orange", reason: "x", choice: "admit" }),
    answer({ class: "yellow", reason: "", choice: "admit" }),
    answer({ class: "yellow", reason: "fine", choice: "merge it" }),
    answer({ class: "green", reason: "fine" }),
  ];
  for (const infer of fails) {
    const c = await classify(p, infer);
    expect(c.cls).toBe("red");
    expect(c.by).toBe("fail");
    expect(c.criteria).toEqual(["product_tradeoff"]);
  }
});

test("a red model answer keeps only known criteria, else the record's own", () => {
  const p = proposal(10);
  expect(parseAnswer(JSON.stringify({ class: "red", reason: "scope", criteria: ["spends_money", "vibes"] }), p).criteria).toEqual(["spends_money"]);
  expect(parseAnswer(JSON.stringify({ class: "red", reason: "scope", criteria: [] }), p).criteria).toEqual(["product_tradeoff"]);
});

test("a long reason is clipped for the board", () => {
  const c = parseAnswer(JSON.stringify({ class: "yellow", reason: "x".repeat(400), choice: "refuse" }), proposal(7));
  expect(c.reason.length).toBe(300);
});

test("the prompt carries the record, the added lines and the reference", () => {
  const { system, user } = triagePrompt(proposal(7, { added: ["line one", "line two"], reference: { objective: "series-runs", text: "export function f() {}" }, spec: "# SPEC", contract: "# CONTRACT" }));
  expect(system).toContain("When unsure whether a case is red, answer red.");
  expect(user).toContain("OPTIONS: admit, refuse");
  expect(user).toContain("ADDED LINES:\nline one\nline two");
  expect(user).toContain("REFERENCE for series-runs:");
  expect(user).toContain("SPEC.md:\n# SPEC");
});

test("a routed record is a valid green or yellow row that names the proposed kind and keeps the ruling key", () => {
  const f = fx(6);
  for (const cls of ["green", "yellow"] as const) {
    const r = routedRecord(f.record, f.kind, { cls, by: "model", reason: "matches the reference", choice: "admit" });
    expect(validateRecord(r, cls)).toBeNull();
    expect(KIND_CLASS[cls === "green" ? "routed_green" : "routed_yellow"]).toBe(cls);
    expect(r.recommendation.choice).toBe("admit");
    expect(r.evidence.refs?.[0]?.startsWith("ruling key: ")).toBe(true);
    expect(r.evidence.refs).toContain("proposed: amendment");
    expect(r.evidence.refs?.length).toBeLessThanOrEqual(20);
  }
});

test("an escalated record stays a valid red row with the classifier's verdict in its evidence", () => {
  const f = fx(1);
  const r = escalatedRecord(f.record, { cls: "red", by: "rule", reason: "a platform file" });
  expect(validateRecord(r, "red")).toBeNull();
  expect(r.evidence.refs).toContain("gyr: red by rule: a platform file");
});

// ISSUE-00035: a public install has no estate inference tool, so the gate falls back to the human.
test("inferenceTool: GYR_INFERENCE wins; with no tool installed it is null", () => {
  const saved = { home: process.env.HOME, tool: process.env.GYR_INFERENCE };
  try {
    process.env.GYR_INFERENCE = "/opt/infer.ts";
    expect(inferenceTool()).toBe("/opt/infer.ts");
    delete process.env.GYR_INFERENCE;
    process.env.HOME = "/nonexistent-home-for-test";
    expect(inferenceTool()).toBeNull();
  } finally {
    process.env.HOME = saved.home;
    if (saved.tool === undefined) delete process.env.GYR_INFERENCE;
    else process.env.GYR_INFERENCE = saved.tool;
  }
});
