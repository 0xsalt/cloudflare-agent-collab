// Check for SPEC.md "Ask: view-push-rate". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-push-rate.js";
import { all, bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { PUSH_RATE } from "./fixtures";

const source = await Bun.file(new URL("../views/view-push-rate.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-push-rate: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-push-rate");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-push-rate: one element per minute with data-count, and a data-total", () => {
  const root = rendered(PUSH_RATE);
  const bars = withAttr(root, "data-count");
  expect(bars).toHaveLength(30);
  expect(bars.map((b) => Number(b.getAttribute("data-count")))).toEqual(PUSH_RATE.points.map((p) => p.count));
  expect(withAttr(root, "data-total").map((t) => t.getAttribute("data-total"))).toEqual(["7"]);
  expect(() => rendered({ window_minutes: 30, points: [] })).not.toThrow();
});
