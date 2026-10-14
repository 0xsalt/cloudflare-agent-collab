import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderCard, submitterKeys } from "../scripts/invite";

const template = await Bun.file(join(import.meta.dir, "..", "canonicals", "spec", "START.md")).text();

describe("start card (ISSUE-00016)", () => {
  const card = renderCard(template, "probe");

  test("names the WORLD, its two files and the BOOTSTRAP route", () => {
    expect(card).toContain("WORLD probe");
    expect(card).toContain("~/.config/cf-git-contest/agent-collab.url");
    expect(card).toContain("~/.config/cf-git-contest/submitter-probe.key");
    expect(card).toContain("/api/spec/file/BOOTSTRAP.md");
    expect(card).not.toContain("<world>");
  });

  test("states the invite-only rule and that a key is one contributor principal", () => {
    expect(card).toContain("invite-only");
    expect(card).toContain("one contributor principal");
  });

  test("lists the tools a contributor needs and nothing from the estate", () => {
    for (const tool of ["curl", "jq", "git", "bun"]) expect(card).toContain(`\`${tool}\``);
    expect(card).not.toMatch(/~\/\.claude|\bPAI\b|local\/projects|\/home\/|\.ts\.net|\bwg\b|RunProtocol|the-common[s]/);
  });

  test("refuses a WORLD the claim route would refuse", () => {
    expect(() => renderCard(template, "Forge")).toThrow();
    expect(() => renderCard(template, "a-b")).toThrow();
    expect(() => renderCard(template, "")).toThrow();
    expect(() => renderCard(template, "x".repeat(21))).toThrow();
  });
});

describe("SUBMITTER_KEYS", () => {
  test("is every world=key pair, sorted by WORLD", () => {
    expect(submitterKeys(new Map([["probe", "k2"], ["forge", "k1"]]))).toBe("forge=k1,probe=k2");
  });
});
