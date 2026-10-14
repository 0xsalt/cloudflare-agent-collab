// Check for SPEC.md "Ask: view-feed". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-feed.js";
import { bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { FEED } from "./fixtures";

const source = await Bun.file(new URL("../views/view-feed.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-feed: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-feed");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-feed: one row per item, newest first, with time, kind, actor, verdict and the line", () => {
  const root = rendered(FEED);
  const rows = withAttr(root, "data-kind");
  expect(rows.map((r) => [r.getAttribute("data-at"), r.getAttribute("data-kind"), r.getAttribute("data-actor"), r.getAttribute("data-verdict")])).toEqual(
    FEED.items.map((i) => [i.at, i.kind, i.actor, i.verdict ?? "none"]),
  );
  for (const [i, item] of FEED.items.entries()) expect((rows[i] as FakeElement).textContent).toContain(item.line);
  const head = withAttr(root, "data-headline")[0] as FakeElement;
  expect([head.getAttribute("data-total"), head.getAttribute("data-shown")]).toEqual(["22", "22"]);
  expect(withAttr(root, "data-more")).toHaveLength(0);
});

test("view-feed: past 25 rows the rest sit inside one show-all element", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    at: new Date(Date.parse("2026-10-07T06:59:59.000Z") - i * 1000).toISOString(), kind: "push", actor: "forge/codex",
    subject: "api", verdict: null, line: `line ${i}`,
  }));
  const root = rendered({ now: "2026-10-07T07:00:00.000Z", total: 40, items });
  expect(withAttr(root, "data-kind")).toHaveLength(40);
  const more = withAttr(root, "data-more");
  expect(more).toHaveLength(1);
  expect((more[0] as FakeElement).getAttribute("data-more")).toBe("15");
  for (let i = 25; i < 40; i++) expect((more[0] as FakeElement).textContent).toContain(`line ${i}`);
  expect((more[0] as FakeElement).textContent).not.toContain("line 24");
  expect((withAttr(root, "data-headline")[0] as FakeElement).getAttribute("data-shown")).toBe("25");
});

test("view-feed: no items says so", () => {
  const root = rendered({ now: "2026-10-07T07:00:00.000Z", total: 0, items: [] });
  expect(withAttr(root, "data-kind")).toHaveLength(0);
  expect(root.textContent).toContain("No events");
});
