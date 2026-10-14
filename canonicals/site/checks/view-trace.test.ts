// Check for SPEC.md "Ask: view-trace". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-trace.js";
import { all, bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { TRACE } from "./fixtures";

const source = await Bun.file(new URL("../views/view-trace.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-trace: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-trace");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-trace: one element per step, in order, showing each detail", () => {
  const root = rendered(TRACE);
  const steps = withAttr(root, "data-step");
  expect(steps.map((s) => [s.getAttribute("data-step"), s.getAttribute("data-at")])).toEqual(TRACE.steps.map((s) => [s.kind, s.at]));
  for (const [i, s] of TRACE.steps.entries()) expect((steps[i] as FakeElement).textContent).toContain(s.detail);
  expect(root.textContent).toContain(TRACE.candidate);
  expect(() => rendered({ candidate: "cand--x--y--z--a--b", steps: [] })).not.toThrow();
});
