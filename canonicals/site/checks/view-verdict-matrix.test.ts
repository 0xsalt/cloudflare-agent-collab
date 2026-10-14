// Check for SPEC.md "Ask: view-verdict-matrix". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-verdict-matrix.js";
import { all, bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { VERDICT_MATRIX } from "./fixtures";

const source = await Bun.file(new URL("../views/view-verdict-matrix.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

test("view-verdict-matrix: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-verdict-matrix");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-verdict-matrix: one element per row, keyed and counted by attribute", () => {
  const root = rendered(VERDICT_MATRIX);
  const rows = withAttr(root, "data-row");
  expect(rows.map((r) => r.getAttribute("data-row"))).toEqual(VERDICT_MATRIX.rows.map((r) => `${r.objective}/${r.world}/${r.harness}`));
  for (const [i, r] of VERDICT_MATRIX.rows.entries()) {
    const el = rows[i] as FakeElement;
    for (const k of ["candidates", "admit", "refuse", "send_back", "owed"] as const) expect(el.getAttribute(`data-${k.replace("_", "-")}`)).toBe(String(r[k]));
  }
  expect(() => rendered({ rows: [] })).not.toThrow();
});
