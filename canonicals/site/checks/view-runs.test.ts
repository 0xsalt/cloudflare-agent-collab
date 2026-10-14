// Check for SPEC.md "Ask: view-runs". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-runs.js";
import { bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { RUNS } from "./fixtures";

const source = await Bun.file(new URL("../views/view-runs.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-runs: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-runs");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-runs: one card per run, in order, with every count and the median", () => {
  const root = rendered(RUNS);
  const cards = withAttr(root, "data-run");
  const keys = ["data-actor", "data-started", "data-ended", "data-claims", "data-slots", "data-candidates", "data-admit", "data-refuse", "data-send-back", "data-owed", "data-median"];
  expect(cards.map((c) => keys.map((k) => c.getAttribute(k)))).toEqual(
    RUNS.runs.map((r) => [r.actor, r.started, r.ended, String(r.claims), String(r.slots), String(r.candidates), String(r.admit), String(r.refuse), String(r.send_back), String(r.owed), r.median_seconds_to_admit === null ? "none" : String(r.median_seconds_to_admit)]),
  );
  expect((cards[1] as FakeElement).textContent).toContain("forge/claude");
  expect((cards[1] as FakeElement).textContent).toContain("2 claims");
  expect((cards[1] as FakeElement).textContent).toContain("2 ADMIT");
  expect((cards[1] as FakeElement).textContent).toContain("75 s");
  expect((withAttr(root, "data-headline")[0] as FakeElement).getAttribute("data-runs")).toBe("3");
});

test("view-runs: no runs says so", () => {
  const root = rendered({ runs: [] });
  expect(withAttr(root, "data-run")).toHaveLength(0);
  expect((withAttr(root, "data-headline")[0] as FakeElement).getAttribute("data-runs")).toBe("0");
  expect(root.textContent).toContain("No run");
});
