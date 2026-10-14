// RUNS.md (ISSUE-00027): the spec canonical's run list parses, and a malformed section names its
// fault, so a bad publish shows on the board instead of a silent empty panel.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseRuns } from "../src/runs";

test("the published RUNS.md parses: run 4a done, run 4b next", async () => {
  const r = parseRuns(await Bun.file(join(import.meta.dir, "..", "canonicals", "spec", "RUNS.md")).text());
  if ("error" in r) throw new Error(r.error);
  expect(r.runs.map((x) => [x.run, x.done, x.objectives])).toEqual([
    ["4a", true, ["amend-*"]],
    ["4b", false, ["series-decisions", "view-decisions"]],
  ]);
  expect(r.runs[1]?.title).toBe("Run 4b: build series-decisions and view-decisions");
  expect(r.runs[1]?.prompt).toContain("forge-to-owner");
});

test("a malformed section names its fault and line", () => {
  const ok = "## Run 5: next\n\nObjectives: series-x\nDone: no\n\n```text\nDo it.\n```\n";
  const err = (t: string): string => {
    const r = parseRuns(t);
    return "error" in r ? r.error : "parsed";
  };
  expect(err(ok)).toBe("parsed");
  expect(err("# nothing here\n")).toBe("no ## Run section");
  expect(err(ok.replace("Objectives: series-x", "Objectives: Series X"))).toContain("line 1: Objectives");
  expect(err(ok.replace("Done: no", "Done: maybe"))).toContain("Done must be yes or no");
  expect(err(ok.replace("```text", "```sh"))).toContain("fenced text block");
  expect(err(ok.replace("Do it.", ""))).toContain("prompt is empty");
  expect(err(ok + ok)).toContain("appears twice");
});
