// Check for SPEC.md "Ask: view-architecture-live". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-architecture-live.js";
import { bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { ARCHITECTURE } from "./fixtures";

const source = await Bun.file(new URL("../views/view-architecture-live.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-architecture-live: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-architecture");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-architecture-live: the Cloudflare layer, two servers, three canonicals, the forks", () => {
  const root = rendered(ARCHITECTURE);
  expect(withAttr(root, "data-node").map((e) => e.getAttribute("data-node"))).toEqual(["cloudflare", "control", "queue", "durable-object"]);
  expect(withAttr(root, "data-world").map((e) => [e.getAttribute("data-world"), e.getAttribute("data-forks")])).toEqual([["commons", "1"], ["forge", "1"]]);
  expect(withAttr(root, "data-canonical").map((e) => [e.getAttribute("data-canonical"), e.getAttribute("data-forks")])).toEqual([["api", "1"], ["site", "1"], ["spec", "0"]]);
  expect(withAttr(root, "data-fork").map((e) => [e.getAttribute("data-fork"), e.getAttribute("data-in"), e.getAttribute("data-from"), e.getAttribute("data-verdict")])).toEqual(
    ARCHITECTURE.forks.map((f) => [f.name, f.canonical, f.world, f.verdict ?? "none"]),
  );
});

test("view-architecture-live: one element per operation, in order, with its edge", () => {
  const root = rendered(ARCHITECTURE);
  expect(withAttr(root, "data-op").map((e) => [e.getAttribute("data-op"), e.getAttribute("data-at"), e.getAttribute("data-edge")])).toEqual(
    ARCHITECTURE.operations.map((o) => [o.kind, o.at, `${o.from}->${o.to}`]),
  );
  expect(() => rendered({ worlds: [], canonicals: [], forks: [], operations: [] })).not.toThrow();
});
