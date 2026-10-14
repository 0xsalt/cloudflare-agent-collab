// The spec amendment loop's rules (ISSUE-00015): scope, additions only, the cite, and which judge
// replays a cited verdict.
import { expect, test } from "bun:test";
import { judgeAdditions, judgeAmendScope, replayKind, resolveCite } from "../scripts/amend";
import type { CitableVerdict } from "../scripts/amend";

const diff = (lines: string[]): string => ["diff --git a/SPEC.md b/SPEC.md", "--- a/SPEC.md", "+++ b/SPEC.md", "@@ -40,0 +41,2 @@", ...lines].join("\n");

test("scope: SPEC.md and CONTRACT.md only, and at least one", () => {
  expect(judgeAmendScope(["SPEC.md"]).result).toBe("pass");
  expect(judgeAmendScope(["SPEC.md", "CONTRACT.md"]).result).toBe("pass");
  expect(judgeAmendScope(["SPEC.md", "BOOTSTRAP.md"]).outside).toEqual(["BOOTSTRAP.md"]);
  expect(judgeAmendScope([]).result).toBe("fail");
});

test("additions: added plain lines and #### headings pass", () => {
  expect(judgeAdditions(diff(["+A candidate exists from its fork event.", "+#### Amendment: orphan verdicts"])).result).toBe("pass");
});

test("additions: any removed or rewritten line fails", () => {
  const r = judgeAdditions(diff(["-Old rule.", "+New rule."]));
  expect([r.result, r.detail]).toEqual(["fail", "removes or rewrites 1 line(s); an amendment only adds lines"]);
});

test("additions: a section or ask heading fails, so the ledger and section numbers stay stable", () => {
  expect(judgeAdditions(diff(["+## 9. New section"])).result).toBe("fail");
  expect(judgeAdditions(diff(["+### Ask: series-sneak (api, HIGH)"])).result).toBe("fail");
  expect(judgeAdditions(diff(["+#### Ask: series-sneak (api, HIGH)"])).result).toBe("fail");
});

test("additions: nothing added, or more than 40 lines, fails", () => {
  expect(judgeAdditions(diff([])).result).toBe("fail");
  expect(judgeAdditions(diff(Array.from({ length: 41 }, (_, i) => `+line ${i}`))).result).toBe("fail");
});

const verdicts: CitableVerdict[] = [
  { candidate: "cand--series-now--forge--codex--w1--d682", canonical: "api", objective: "series-now", verdict: "SEND_BACK", commit: "a".repeat(40), reason: "hidden: 4 of 10 hidden cases differ", ruled_at: "2026-10-09T03:11:50Z" },
  { candidate: "cand--series-runs--forge--codex--w1--35cb", canonical: "api", objective: "series-runs", verdict: "SEND_BACK", commit: "b".repeat(40), reason: "check: checks/series-runs.test.ts: 3 pass, 1 fail", ruled_at: "2026-10-09T03:12:31Z" },
  { candidate: "cand--view-now--forge--codex--w1--54b3", canonical: "site", objective: "view-now", verdict: "ADMIT", commit: "c".repeat(40), reason: "every check passes", ruled_at: "2026-10-09T03:13:04Z" },
  { candidate: "cand--amend-x--forge--codex--w1--0001", canonical: "spec", objective: "amend-x", verdict: "SEND_BACK", commit: "d".repeat(40), reason: "note: x", ruled_at: "2026-10-09T05:00:00Z" },
];

test("cite: resolves a recorded verdict on an api or site candidate", () => {
  expect(resolveCite({ candidate: verdicts[0]?.candidate, commit: "a".repeat(40) }, verdicts).verdict?.objective).toBe("series-now");
  expect(resolveCite(undefined, verdicts).problem).toBe("the note has no cites object {candidate, commit}");
  expect(resolveCite({ candidate: verdicts[0]?.candidate, commit: "abc" }, verdicts).problem).toContain("40 hex");
  expect(resolveCite({ candidate: verdicts[0]?.candidate, commit: "e".repeat(40) }, verdicts).problem).toContain("no recorded verdict");
  // An amendment cannot cite another amendment's ruling.
  expect(resolveCite({ candidate: verdicts[3]?.candidate, commit: "d".repeat(40) }, verdicts).verdict).toBeNull();
});

test("replay: a hidden or public-check SEND_BACK replays with that judge; anything else does not", () => {
  expect(verdicts.map((v) => replayKind(v))).toEqual(["hidden", "check", null, null]);
});
