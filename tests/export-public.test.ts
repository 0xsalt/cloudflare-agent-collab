import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allowed, brokenLinks, sweepText } from "../scripts/export-public";

describe("public export boundary (ISSUE-00036)", () => {
  test("private paths are excluded by construction", () => {
    for (const p of ["SPEC.md", "CLAUDE.md", "CHANGELOG.md", "LLMS.txt", "docs/plan/00-context.md", "docs/plan/sources/brief.md",
      "docs/internal/notes.md", "docs/decisions/001-x.md", "tools/spec-sync.ts", "scripts/cf-git.ts", "scripts/poc.ts", ".cf.env"]) {
      expect(allowed(p)).toBe(false);
    }
  });

  test("the product ships", () => {
    for (const p of ["src/index.ts", "canonicals/spec/START.md", "tests/invite.test.ts", "scripts/install.ts", "scripts/uninstall.ts", "README.md", "LICENSE"]) {
      expect(allowed(p)).toBe(true);
    }
  });

  test("every ../scripts import in a shipped test names a shipped file", () => {
    const dir = import.meta.dir;
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/from\s+["']\.\.\/scripts\/([\w.-]+)["']/g)) {
        const name = m[1]!.replace(/\.(ts|sh)$/, "");
        if (!allowed(`tests/${f}`)) continue;
        if (!allowed(`scripts/${name}.ts`) && !allowed(`scripts/${name}`)) missing.push(`${f} imports scripts/${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("each leak rule fires on a sample line", () => {
    const samples = [
      ["x.md", "host.example.ts" + ".net"],
      ["x.md", "/ho" + "me/someone/file"],
      ["x.md", "cf" + "ut_abc"],
      ["x.md", "art_v2" + "_u_35f4"],
      ["x.md", "id " + "0123456789abcdef" + "0123456789abcdef" + " end"],
      ["x.md", "https://agent-collab-control.someone.wor" + "kers.dev/"],
      ["x.md", "~/.cla" + "ude/settings"],
    ] as const;
    for (const [f, line] of samples) expect(sweepText(f, line).length).toBe(1);
  });

  test("a clean line has no finding", () => {
    expect(sweepText("x.md", "export AGENT_COLLAB_URL=\"$(cat ~/.config/cf-git-contest/agent-collab.url)\"")).toEqual([]);
  });

  test("a relative link to an unshipped file is a finding", () => {
    const shipped = new Set(["README.md", "docs/poc/POC.md"]);
    expect(brokenLinks("docs/poc/POC.md", "[r](../../README.md) [w](https://example.com) [a](#top)", shipped)).toEqual([]);
    expect(brokenLinks("README.md", "[s](SPEC.md)", shipped)).toHaveLength(1);
  });
});
