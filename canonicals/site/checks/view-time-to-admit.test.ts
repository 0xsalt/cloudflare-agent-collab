// Check for SPEC.md "Ask: view-time-to-admit". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-time-to-admit.js";
import { all, bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { TIME_TO_ADMIT } from "./fixtures";

const source = await Bun.file(new URL("../views/view-time-to-admit.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-time-to-admit: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-time-to-admit");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-time-to-admit: one element per sample, and p50, p90 and max stats", () => {
  const root = rendered(TIME_TO_ADMIT);
  const rows = withAttr(root, "data-candidate");
  expect(rows.map((r) => [r.getAttribute("data-candidate"), r.getAttribute("data-seconds")])).toEqual(TIME_TO_ADMIT.samples.map((s) => [s.candidate, String(s.seconds)]));
  const stat = (name: string) => all(root).find((e) => e.getAttribute("data-stat") === name)?.textContent ?? "";
  expect(stat("p50")).toContain("75");
  expect(stat("p90")).toContain("130");
  expect(stat("max")).toContain("130");
  expect(() => rendered({ samples: [], p50: null, p90: null, max: null })).not.toThrow();
});
