// Check for SPEC.md "Ask: view-now". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-now.js";
import { bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { NOW } from "./fixtures";

const source = await Bun.file(new URL("../views/view-now.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-now: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-now");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-now: the headline counts actors by state", () => {
  const head = withAttr(rendered(NOW), "data-headline")[0] as FakeElement;
  expect(head.getAttribute("data-actors")).toBe("4");
  expect(["data-claiming", "data-building", "data-awaiting-verdict", "data-ruling", "data-idle"].map((k) => head.getAttribute(k))).toEqual(["0", "2", "0", "0", "2"]);
  expect(head.textContent).toContain("building");
});

test("view-now: one row per actor, in order, with state, since, age from the series' now, and the last line", () => {
  const rows = withAttr(rendered(NOW), "data-actor");
  expect(rows.map((r) => [r.getAttribute("data-actor"), r.getAttribute("data-state"), r.getAttribute("data-since"), r.getAttribute("data-age")])).toEqual([
    ["commons/script", "building", "2026-10-07T06:45:01.000Z", "899"],
    ["forge/claude", "idle", "2026-10-07T06:51:00.000Z", "540"],
    ["forge/codex", "building", "2026-10-07T06:35:00.000Z", "1500"],
    ["authority", "idle", "2026-10-07T06:59:30.000Z", "30"],
  ]);
  for (const [i, a] of NOW.actors.entries()) expect((rows[i] as FakeElement).textContent).toContain(a.last.line);
});

test("view-now: no actors says so and renders nothing else", () => {
  const root = rendered({ now: "2026-10-07T07:00:00.000Z", actors: [] });
  expect(withAttr(root, "data-actor")).toHaveLength(0);
  expect((withAttr(root, "data-headline")[0] as FakeElement).getAttribute("data-actors")).toBe("0");
  expect(root.textContent).toContain("No actor");
});
