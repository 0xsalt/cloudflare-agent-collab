// Check for SPEC.md "Ask: series-decisions". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-decisions";
import type { ObsEvent } from "../src/events";
import { EVENTS, NOW } from "./harness";

type Item = { id: number; class: string; kind: string; subject: string; summary: string | null; recommendation: string | null; red_criteria: string[]; opened_at: string; decided_at: string | null; action: string | null; actor: string | null };
type Decisions = { open: Item[]; decided: Item[]; by_class: { red: number; yellow: number; green: number } };

function decision(id: number, over: Record<string, string | number | null>, at: string): ObsEvent {
  return {
    source: "arena", kind: "decision", subject: `decision-${id}`, at,
    fields: {
      class: "red", kind: "admission_error", status: "open", action: null, actor: null, decided_at: null,
      subject: "cand--series-trace--forge--codex--w1--s3", red_criteria: "authority_error", summary: `Retry decision ${id}`, recommendation: "retry", ...over,
    },
  };
}

test("series-decisions: open red rows and decided rows, by class, from the fixture", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    open: [
      {
        id: 1, class: "red", kind: "reserved_path", subject: "cand--view-trace--commons--script--a1--s2",
        summary: "Approve admitting view-trace slot a1 although it changes wrangler.jsonc", recommendation: "refuse", red_criteria: ["reserved"],
        opened_at: "2026-10-07T06:46:30.000Z", decided_at: null, action: null, actor: null,
      },
    ],
    decided: [
      {
        id: 2, class: "yellow", kind: "send_back", subject: "cand--series-push-rate--forge--claude--w2--s1",
        summary: "Candidate series-push-rate slot w2 was sent back: check failed", recommendation: "send_back", red_criteria: [],
        opened_at: "2026-10-07T06:44:41.000Z", decided_at: "2026-10-07T06:44:41.000Z", action: null, actor: null,
      },
    ],
    by_class: { red: 1, yellow: 1, green: 0 },
  });
});

test("series-decisions: open rows run newest opened first, at equal times the higher id first", () => {
  const out = derive([...EVENTS, decision(3, {}, "2026-10-07T06:50:00.000Z"), decision(4, {}, "2026-10-07T06:50:00.000Z"), decision(5, {}, "2026-10-07T06:20:00.000Z")], { now: NOW }) as Decisions;
  expect(out.open.map((d) => d.id)).toEqual([4, 3, 1, 5]);
  expect(out.by_class).toEqual({ red: 4, yellow: 1, green: 0 });
});

test("series-decisions: decided rows run newest decided first, whatever their open time", () => {
  const events = [
    decision(3, { status: "decided", action: "approve", actor: "viewer", decided_at: "2026-10-07T06:58:00.000Z" }, "2026-10-07T06:40:00.000Z"),
    decision(4, { status: "decided", action: "stop", actor: "admin", decided_at: "2026-10-07T06:30:00.000Z" }, "2026-10-07T06:35:00.000Z"),
    decision(5, { class: "green", kind: "admit", status: "decided", red_criteria: "", decided_at: "2026-10-07T06:30:00.000Z" }, "2026-10-07T06:29:00.000Z"),
  ];
  const out = derive(events, { now: NOW }) as Decisions;
  expect(out.open).toEqual([]);
  expect(out.decided.map((d) => [d.id, d.action, d.actor])).toEqual([[3, "approve", "viewer"], [5, null, null], [4, "stop", "admin"]]);
  expect(out.by_class).toEqual({ red: 2, yellow: 0, green: 1 });
});

test("series-decisions: red_criteria split on commas, and an empty value is an empty list", () => {
  const out = derive([decision(3, { red_criteria: "reserved,authority_error" }, "2026-10-07T06:50:00.000Z"), decision(4, { class: "green", red_criteria: "" }, "2026-10-07T06:51:00.000Z")], { now: NOW }) as Decisions;
  expect(out.open.map((d) => d.red_criteria)).toEqual([[], ["reserved", "authority_error"]]);
});

test("series-decisions: no decision events gives empty lists and zero counts", () => {
  expect(derive(EVENTS.filter((e) => e.kind !== "decision"), { now: NOW })).toEqual({ open: [], decided: [], by_class: { red: 0, yellow: 0, green: 0 } });
  expect(derive([], { now: NOW })).toEqual({ open: [], decided: [], by_class: { red: 0, yellow: 0, green: 0 } });
});
