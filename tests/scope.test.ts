// The scope check and its waiver (ISSUE-00021). Run: bun test tests/
import { describe, expect, test } from "bun:test";
import { judgeScope } from "../scripts/scope";

const ASK = "views/view-trace.js";

describe("judgeScope", () => {
  test("only the ask file passes", () => {
    expect(judgeScope([ASK], ASK, [])).toEqual({ result: "pass", detail: `changes only ${ASK}`, outside: [] });
  });

  test("no change fails", () => {
    expect(judgeScope([], ASK, [])).toEqual({ result: "fail", detail: "no change from base", outside: [] });
  });

  test("a path outside the ask file fails and is named", () => {
    expect(judgeScope([ASK, "wrangler.jsonc", "src/index.ts"], ASK, [])).toEqual({
      result: "fail", detail: `changes outside ${ASK}: wrangler.jsonc, src/index.ts`, outside: ["wrangler.jsonc", "src/index.ts"],
    });
  });

  test("a waiver covers the named paths and no others", () => {
    expect(judgeScope([ASK, "wrangler.jsonc"], ASK, ["wrangler.jsonc"])).toEqual({
      result: "pass", detail: `changes ${ASK} and waived wrangler.jsonc`, outside: [],
    });
    expect(judgeScope([ASK, "wrangler.jsonc", "package.json"], ASK, ["wrangler.jsonc"])).toEqual({
      result: "fail", detail: `changes outside ${ASK}: package.json`, outside: ["package.json"],
    });
  });

  test("a waiver never stands in for the ask file", () => {
    expect(judgeScope(["wrangler.jsonc"], ASK, ["wrangler.jsonc"])).toEqual({
      result: "fail", detail: `a waiver covers extra paths only; ${ASK} is unchanged`, outside: [],
    });
  });

  test("a waiver for a path that did not change is harmless", () => {
    expect(judgeScope([ASK], ASK, ["wrangler.jsonc"])).toEqual({ result: "pass", detail: `changes only ${ASK}`, outside: [] });
  });
});
