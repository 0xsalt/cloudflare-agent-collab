// Check for SPEC.md "Ask: view-decisions". Reserved path.
import { expect, test } from "bun:test";
import * as view from "../views/view-decisions.js";
import { all, bannedTokens, fakeDocument, withAttr, type FakeElement } from "./dom";
import { DECISIONS } from "./fixtures";

const source = await Bun.file(new URL("../views/view-decisions.js", import.meta.url)).text();

function rendered(data: unknown): FakeElement {
  const root = fakeDocument.createElement("div");
  view.render(root, data, fakeDocument);
  return root;
}

// An open item carries data-class; a decided item carries data-action.
const openOf = (root: FakeElement): FakeElement[] => withAttr(root, "data-decision").filter((e) => e.getAttribute("data-class") !== null);
const decidedOf = (root: FakeElement): FakeElement[] => withAttr(root, "data-decision").filter((e) => e.getAttribute("data-action") !== null);

const MORE = {
  open: [
    { id: 7, class: "red", kind: "admission_error", subject: "cand--series-now--forge--codex--w1--s9", summary: "Retry the ruling on series-now slot w1 after an authority error", recommendation: "retry", red_criteria: ["authority_error"], opened_at: "2026-10-07T06:55:00.000Z", decided_at: null, action: null, actor: null },
    { id: 6, class: "red", kind: "reserved_path", subject: "cand--view-now--forge--codex--w1--s9", summary: "Approve admitting view-now slot w1 although it changes src/index.ts", recommendation: "refuse", red_criteria: ["reserved", "authority_error"], opened_at: "2026-10-07T06:50:00.000Z", decided_at: null, action: null, actor: null },
  ],
  decided: [
    { id: 5, class: "red", kind: "reserved_path", subject: "cand--view-feed--forge--codex--w1--s9", summary: "Approve admitting view-feed slot w1 although it changes wrangler.jsonc", recommendation: "refuse", red_criteria: ["reserved"], opened_at: "2026-10-07T06:40:00.000Z", decided_at: "2026-10-07T06:58:00.000Z", action: "reject", actor: "viewer" },
    { id: 4, class: "green", kind: "admit", subject: "cand--series-feed--forge--codex--w1--s9", summary: "Candidate series-feed slot w1 was admitted", recommendation: "admit", red_criteria: [], opened_at: "2026-10-07T06:30:00.000Z", decided_at: "2026-10-07T06:30:00.000Z", action: null, actor: null },
  ],
  by_class: { red: 3, yellow: 0, green: 1 },
};

test("view-decisions: declares itself built and renders data only", () => {
  expect(view.built).toBe(true);
  expect(view.series).toBe("series-decisions");
  expect(bannedTokens(source)).toEqual([]);
});

test("view-decisions: the headline counts open and decided and says a human is needed", () => {
  const head = withAttr(rendered(DECISIONS), "data-headline")[0] as FakeElement;
  expect([head.getAttribute("data-open"), head.getAttribute("data-decided")]).toEqual(["1", "1"]);
  expect(head.textContent).toContain("1 decision needs a human");
  const more = withAttr(rendered(MORE), "data-headline")[0] as FakeElement;
  expect([more.getAttribute("data-open"), more.getAttribute("data-decided")]).toEqual(["2", "2"]);
  expect(more.textContent).toContain("2 decisions need a human");
});

test("view-decisions: one element per open item, in order, with class, kind, subject, summary and recommendation", () => {
  const items = openOf(rendered(MORE));
  expect(items.map((e) => ["data-decision", "data-class", "data-kind", "data-subject"].map((k) => e.getAttribute(k)))).toEqual([
    ["7", "red", "admission_error", "cand--series-now--forge--codex--w1--s9"],
    ["6", "red", "reserved_path", "cand--view-now--forge--codex--w1--s9"],
  ]);
  expect((items[0] as FakeElement).textContent).toContain("Retry the ruling on series-now slot w1 after an authority error");
  expect((items[0] as FakeElement).textContent).toContain("retry");
  expect((items[1] as FakeElement).textContent).toContain("refuse");
  expect(decidedOf(rendered(MORE)).some((e) => e.getAttribute("data-class") !== null)).toBe(false);
});

test("view-decisions: one element per decided item, in order, with its action, none without one", () => {
  const items = decidedOf(rendered(MORE));
  expect(items.map((e) => [e.getAttribute("data-decision"), e.getAttribute("data-action")])).toEqual([["5", "reject"], ["4", "none"]]);
  expect((items[0] as FakeElement).textContent).toContain("viewer");
  expect(decidedOf(rendered(DECISIONS)).map((e) => [e.getAttribute("data-decision"), e.getAttribute("data-action")])).toEqual([["2", "none"]]);
});

test("view-decisions: nothing open says so, and an empty series renders no items", () => {
  const root = rendered({ open: [], decided: [], by_class: { red: 0, yellow: 0, green: 0 } });
  expect(withAttr(root, "data-decision")).toHaveLength(0);
  const head = withAttr(root, "data-headline")[0] as FakeElement;
  expect([head.getAttribute("data-open"), head.getAttribute("data-decided")]).toEqual(["0", "0"]);
  expect(head.textContent).toContain("No decision needs a human");
  expect(all(root).every((e) => e.getAttribute("data-class") === null)).toBe(true);
});
