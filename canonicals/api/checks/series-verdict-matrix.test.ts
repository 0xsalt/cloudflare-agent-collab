// Check for SPEC.md "Ask: series-verdict-matrix". Reserved path.
import { expect, test } from "bun:test";
import { derive } from "../src/series/series-verdict-matrix";
import { EVENTS, NOW } from "./harness";

test("series-verdict-matrix: latest verdict per candidate, by objective, world and harness", () => {
  expect(derive(EVENTS, { now: NOW })).toEqual({
    rows: [
      { objective: "series-push-rate", world: "forge", harness: "claude", candidates: 2, admit: 1, refuse: 1, send_back: 0, owed: 0 },
      { objective: "series-trace", world: "forge", harness: "codex", candidates: 1, admit: 0, refuse: 0, send_back: 1, owed: 0 },
      { objective: "view-trace", world: "commons", harness: "script", candidates: 1, admit: 0, refuse: 0, send_back: 0, owed: 1 },
      { objective: "view-trace", world: "forge", harness: "claude", candidates: 1, admit: 1, refuse: 0, send_back: 0, owed: 0 },
    ],
  });
});
