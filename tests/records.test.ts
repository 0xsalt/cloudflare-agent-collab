// The authority is the writer of Decision Records, so completeness is mechanical: every builder's
// output must pass the Worker's own validation. Run: bun test tests/
import { describe, expect, test } from "bun:test";
import { ACTIONS, validateRecord } from "../src/decisions";
import { admissionErrorRecord, admitRecord, amendmentRecord, reservedPathRecord, sendBackRecord, scopeBlast } from "../scripts/records";

const CAND = "cand--view-trace--commons--script--a1--s2";

describe("reservedPathRecord", () => {
  const rec = reservedPathRecord({ candidate: CAND, askFile: "views/view-trace.js", paths: ["wrangler.jsonc", "src/index.ts"], reason: "scope: changes outside views/view-trace.js: wrangler.jsonc, src/index.ts" });

  test("passes the Worker's validation as a red record", () => {
    expect(validateRecord(rec, "red")).toBeNull();
  });

  test("asks whether to keep the refusal, names the paths, and recommends refusing", () => {
    expect(rec.decision_requested.summary).toBe("Keep the refusal of view-trace slot a1?");
    expect(rec.why_now.summary).toContain("wrangler.jsonc, src/index.ts");
    expect(rec.why_now.red_criteria).toEqual(["reserved"]);
    expect(rec.evidence.refs).toEqual(["wrangler.jsonc", "src/index.ts"]);
    expect(rec.evidence.detail).toContain(CAND);
    expect(rec.alternatives.options.map((o) => o.name)).toEqual(["refuse", "waive"]);
    expect(rec.recommendation.choice).toBe("refuse");
    expect(rec.no_action_baseline.summary).toBe("The refusal stands, and the ask stays open for another candidate.");
    expect(rec.blast_radius.summary.startsWith("Do not waive a platform file.")).toBe(true);
    expect(rec.reversibility.reversal_cost).toBe("low");
    expect(rec.time_control).toMatchObject({ urgency: "low", deferral_safe: true, controls: [...ACTIONS] });
  });

  test("blast radius is high for wrangler.jsonc or src/ outside series, else medium", () => {
    expect(scopeBlast(["wrangler.jsonc"])).toBe("high");
    expect(scopeBlast(["README.md", "src/index.ts"])).toBe("high");
    expect(scopeBlast(["src/events.ts"])).toBe("high");
    expect(scopeBlast(["src/series/series-other.ts"])).toBe("medium");
    expect(scopeBlast(["package.json", "checks/x.test.ts"])).toBe("medium");
  });

  test("more than twenty paths still validate, with the rest counted in the detail", () => {
    const many = Array.from({ length: 25 }, (_, i) => `docs/file-${i}.md`);
    const big = reservedPathRecord({ candidate: CAND, askFile: "views/view-trace.js", paths: many, reason: "scope" });
    expect(validateRecord(big, "red")).toBeNull();
    expect(big.evidence.refs).toHaveLength(20);
    expect(big.evidence.detail).toContain("5 more");
  });
});

describe("admissionErrorRecord", () => {
  const rec = admissionErrorRecord({ candidate: CAND, key: `${CAND} ${"a".repeat(40)} 0`, error: "clone failed: boom" });

  test("passes as a red record with the authority_error criterion", () => {
    expect(validateRecord(rec, "red")).toBeNull();
    expect(rec.why_now.red_criteria).toEqual(["authority_error"]);
  });

  test("offers retry, send_back and stop; recommends retry; carries the key and the error", () => {
    expect(rec.decision_requested.summary).toBe("Retry the ruling on view-trace slot a1?");
    expect(rec.alternatives.options.map((o) => o.name)).toEqual(["retry", "send_back", "stop"]);
    expect(rec.recommendation.choice).toBe("retry");
    expect(rec.evidence.summary).toBe("clone failed: boom");
    expect(rec.evidence.refs).toEqual([`ruling key: ${CAND} ${"a".repeat(40)} 0`]);
    expect(rec.reversibility.reversal_cost).toBe("low");
    expect(rec.time_control).toMatchObject({ urgency: "medium", deferral_safe: true });
  });

  test("an error of 500 characters or an empty one still validates", () => {
    expect(validateRecord(admissionErrorRecord({ candidate: CAND, key: "k", error: "e".repeat(900) }), "red")).toBeNull();
    expect(validateRecord(admissionErrorRecord({ candidate: CAND, key: "k", error: "" }), "red")).toBeNull();
  });
});

describe("green and yellow records", () => {
  test("a SEND_BACK is yellow and an ADMIT is green, both valid and short", () => {
    const yellow = sendBackRecord({ candidate: CAND, reason: "hidden: 4 of 10 hidden cases differ" });
    const green = admitRecord({ candidate: CAND, tag: "v0.12.0" });
    expect(validateRecord(yellow, "yellow")).toBeNull();
    expect(validateRecord(green, "green")).toBeNull();
    expect(yellow.decision_requested.summary).toBe("view-trace slot a1 was sent back: hidden: 4 of 10 hidden cases differ");
    expect(green.decision_requested.summary).toBe("view-trace slot a1 was admitted as v0.12.0");
    expect(yellow.recommendation.choice).toBe("send_back");
    expect(green.recommendation.choice).toBe("admit");
  });

  test("a long reason is cut to fit", () => {
    expect(validateRecord(sendBackRecord({ candidate: CAND, reason: "r".repeat(900) }), "yellow")).toBeNull();
  });
});

describe("amendmentRecord", () => {
  const rec = amendmentRecord({
    candidate: "cand--amend-orphan-verdict--forge--codex--w1--ab12", key: "cand--amend-orphan-verdict--forge--codex--w1--ab12 " + "a".repeat(40),
    added: ["", "An orphan verdict updates the agent's roster row and adds no candidate."], files: ["SPEC.md"],
    cited: "SEND_BACK on series-now at 2026-10-09T03:11:50Z", replay: "the hidden check still refuses series-now (try 1)", reason: "Answers run-3 question 2.",
  });
  test("is a valid red record with admit and refuse, recommending admit", () => {
    expect(validateRecord(rec, "red")).toBeNull();
    expect(rec.alternatives.options.map((o) => o.name)).toEqual(["admit", "refuse"]);
    expect(rec.recommendation.choice).toBe("admit");
    expect(rec.decision_requested.summary).toBe("Admit the amendment amend-orphan-verdict to SPEC.md?");
    expect(rec.evidence.refs?.[0]?.startsWith("ruling key: ")).toBe(true);
  });
  test("stays valid with many long added lines", () => {
    const big = amendmentRecord({ candidate: "c", key: "k", added: Array.from({ length: 40 }, () => "x".repeat(400)), files: ["SPEC.md", "CONTRACT.md"], cited: "c", replay: "r", reason: "r".repeat(600) });
    expect(validateRecord(big, "red")).toBeNull();
  });
});

// Chris, 2026-10-08: every red brief reads by the writing-style-guide, checked by style-lint over the
// text the board renders. The ASK is a heading; each other part is a paragraph; the buttons are steps.
describe("red briefs pass style-lint", () => {
  const lint = Bun.which("style-lint");
  const briefs = {
    reserved_path: reservedPathRecord({ candidate: CAND, askFile: "views/view-trace.js", paths: ["wrangler.jsonc"], reason: "scope: changes outside views/view-trace.js: wrangler.jsonc" }),
    admission_error: admissionErrorRecord({ candidate: CAND, key: "k", error: "The clone failed with exit 128." }),
    amendment: amendmentRecord({ candidate: "cand--amend-tie-order--forge--codex--w1--ab12", key: "k", added: ["Equal timestamps sort by kind, then subject."], files: ["SPEC.md"], cited: "ADMIT on series-now", replay: "nothing to replay", reason: "Answers the tie-order question." }),
  };
  for (const [kind, r] of Object.entries(briefs)) {
    test.skipIf(lint === null)(`${kind} brief has no style-lint error`, async () => {
      const parts = [r.why_now.summary, r.evidence.summary, r.recommendation.summary, r.alternatives.summary, r.no_action_baseline.summary, r.blast_radius.summary, r.cost_tradeoffs.summary, r.reversibility.summary, r.time_control.summary];
      const steps = r.alternatives.options.map((o, i) => `${i + 1}. ${o.summary.split(/[.;]/)[0]}.`);
      const md = [`# ${r.decision_requested.summary}`, "", ...parts.flatMap((p) => [p, ""]), ...steps, ""].join("\n");
      const file = `${process.env.TMPDIR ?? "/tmp"}/brief-${kind}-${process.pid}.md`;
      await Bun.write(file, md);
      // Sentence length is a WARN in style-lint, so the brief must carry no finding at all.
      const out = Bun.spawnSync([lint as string, "--json", file]);
      const findings = (JSON.parse(out.stdout.toString()) as { findings: { rule: string; message: string }[] }).findings;
      expect(findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([]);
      expect(md).not.toContain("\u2014");
    });
  }
});
