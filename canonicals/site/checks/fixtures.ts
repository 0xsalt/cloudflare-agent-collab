// Series payloads as api serves them in data, for the view checks. Reserved path.
// They match api's checks on api's fixture, so a view built here renders the real series.

const start = Date.parse("2026-10-07T06:31:00.000Z");
const counts: Record<number, number> = { 11: 2, 12: 1, 13: 1, 16: 1, 19: 1, 28: 1 };
export const PUSH_RATE = {
  window_minutes: 30,
  points: Array.from({ length: 30 }, (_, i) => ({ minute: new Date(start + i * 60000).toISOString(), count: counts[i] ?? 0 })),
};

export const TIME_TO_ADMIT = {
  samples: [
    { candidate: "cand--view-trace--forge--claude--w1--s5", seconds: 75 },
    { candidate: "cand--series-push-rate--forge--claude--w1--s1", seconds: 130 },
  ],
  p50: 75,
  p90: 130,
  max: 130,
};

export const VERDICT_MATRIX = {
  rows: [
    { objective: "series-push-rate", world: "forge", harness: "claude", candidates: 2, admit: 1, refuse: 1, send_back: 0, owed: 0 },
    { objective: "series-trace", world: "forge", harness: "codex", candidates: 1, admit: 0, refuse: 0, send_back: 1, owed: 0 },
    { objective: "view-trace", world: "commons", harness: "script", candidates: 1, admit: 0, refuse: 0, send_back: 0, owed: 1 },
    { objective: "view-trace", world: "forge", harness: "claude", candidates: 1, admit: 1, refuse: 0, send_back: 0, owed: 0 },
  ],
};

export const TRACE = {
  candidate: "cand--series-push-rate--forge--claude--w2--s1",
  steps: [
    { kind: "claim", at: "2026-10-07T06:40:00.000Z", detail: "forge/claude/s1" },
    { kind: "fork", at: "2026-10-07T06:40:03.000Z", detail: "api" },
    { kind: "push", at: "2026-10-07T06:43:00.000Z", detail: "refs/heads/main" },
    { kind: "verdict", at: "2026-10-07T06:44:40.000Z", detail: "SEND_BACK" },
    { kind: "push", at: "2026-10-07T06:50:00.000Z", detail: "refs/heads/main" },
    { kind: "verdict", at: "2026-10-07T06:51:00.000Z", detail: "REFUSE" },
  ],
};

export const NOW = {
  now: "2026-10-07T07:00:00.000Z",
  actors: [
    {
      actor: "commons/script", world: "commons", harness: "script", state: "building", since: "2026-10-07T06:45:01.000Z",
      last: { at: "2026-10-07T06:45:01.000Z", kind: "fork", line: "forked site for view-trace, slot a1" }, open: 1, owed: 0,
    },
    {
      actor: "forge/claude", world: "forge", harness: "claude", state: "idle", since: "2026-10-07T06:51:00.000Z",
      last: { at: "2026-10-07T06:51:00.000Z", kind: "verdict", line: "REFUSE series-push-rate slot w2: objective already admitted" }, open: 0, owed: 0,
    },
    {
      actor: "forge/codex", world: "forge", harness: "codex", state: "building", since: "2026-10-07T06:35:00.000Z",
      last: { at: "2026-10-07T06:35:00.000Z", kind: "verdict", line: "SEND_BACK series-trace slot w1: check failed" }, open: 1, owed: 0,
    },
    {
      actor: "authority", world: "authority", harness: "admission", state: "idle", since: "2026-10-07T06:59:30.000Z",
      last: { at: "2026-10-07T06:59:30.000Z", kind: "push", line: "site main: Admit view-trace" }, open: 2, owed: 0,
    },
  ],
};

const A1 = "cand--series-push-rate--forge--claude--w1--s1";
const A2 = "cand--series-push-rate--forge--claude--w2--s1";
const T1 = "cand--series-trace--forge--codex--w1--s3";
const V1 = "cand--view-trace--commons--script--a1--s2";
const V2 = "cand--view-trace--forge--claude--w1--s5";
export const FEED = {
  now: "2026-10-07T07:00:00.000Z",
  total: 22,
  items: [
    { at: "2026-10-07T06:59:30.000Z", kind: "push", actor: "authority", subject: "site", verdict: null, line: "site main: Admit view-trace" },
    { at: "2026-10-07T06:51:00.000Z", kind: "verdict", actor: "authority", subject: A2, verdict: "REFUSE", line: "REFUSE series-push-rate slot w2: objective already admitted" },
    { at: "2026-10-07T06:50:00.000Z", kind: "push", actor: "forge/claude", subject: A2, verdict: null, line: "pushed series-push-rate slot w2: Resubmit" },
    { at: "2026-10-07T06:48:15.000Z", kind: "verdict", actor: "authority", subject: V2, verdict: "ADMIT", line: "ADMIT view-trace slot w1: every check passes" },
    { at: "2026-10-07T06:47:00.000Z", kind: "push", actor: "forge/claude", subject: V2, verdict: null, line: "pushed view-trace slot w1: Trace view" },
    { at: "2026-10-07T06:46:00.000Z", kind: "fork", actor: "forge/claude", subject: V2, verdict: null, line: "forked site for view-trace, slot w1" },
    { at: "2026-10-07T06:45:58.000Z", kind: "claim", actor: "forge/claude", subject: "claim-4", verdict: null, line: "claimed 1 slot on site for view-trace" },
    { at: "2026-10-07T06:45:01.000Z", kind: "fork", actor: "commons/script", subject: V1, verdict: null, line: "forked site for view-trace, slot a1" },
    { at: "2026-10-07T06:45:00.000Z", kind: "claim", actor: "commons/script", subject: "claim-3", verdict: null, line: "claimed 1 slot on site for view-trace" },
    { at: "2026-10-07T06:44:40.000Z", kind: "verdict", actor: "authority", subject: A2, verdict: "SEND_BACK", line: "SEND_BACK series-push-rate slot w2: check failed" },
    { at: "2026-10-07T06:44:30.000Z", kind: "push", actor: "authority", subject: "api", verdict: null, line: "api main: Admit series-push-rate" },
    { at: "2026-10-07T06:44:20.000Z", kind: "verdict", actor: "authority", subject: A1, verdict: "ADMIT", line: "ADMIT series-push-rate slot w1: every check passes" },
    { at: "2026-10-07T06:43:00.000Z", kind: "push", actor: "forge/claude", subject: A2, verdict: null, line: "pushed series-push-rate slot w2: Push rate" },
    { at: "2026-10-07T06:42:15.000Z", kind: "push", actor: "forge/claude", subject: A1, verdict: null, line: "noted series-push-rate slot w1" },
    { at: "2026-10-07T06:42:10.000Z", kind: "push", actor: "forge/claude", subject: A1, verdict: null, line: "pushed series-push-rate slot w1: Push rate" },
    { at: "2026-10-07T06:40:03.000Z", kind: "fork", actor: "forge/claude", subject: A2, verdict: null, line: "forked api for series-push-rate, slot w2" },
    { at: "2026-10-07T06:40:02.000Z", kind: "fork", actor: "forge/claude", subject: A1, verdict: null, line: "forked api for series-push-rate, slot w1" },
    { at: "2026-10-07T06:40:00.000Z", kind: "claim", actor: "forge/claude", subject: "claim-2", verdict: null, line: "claimed 2 slots on api for series-push-rate" },
    { at: "2026-10-07T06:35:00.000Z", kind: "verdict", actor: "authority", subject: T1, verdict: "SEND_BACK", line: "SEND_BACK series-trace slot w1: check failed" },
    { at: "2026-10-07T06:30:00.000Z", kind: "fork", actor: "forge/codex", subject: T1, verdict: null, line: "forked api for series-trace, slot w1" },
    { at: "2026-10-07T06:29:58.000Z", kind: "claim", actor: "forge/codex", subject: "claim-1", verdict: null, line: "claimed 1 slot on api for series-trace" },
    { at: "2026-10-07T06:01:00.000Z", kind: "push", actor: "authority", subject: "api", verdict: null, line: "api main: Seed api canonical" },
  ],
};

export const RUNS = {
  runs: [
    {
      actor: "commons/script", world: "commons", harness: "script", started: "2026-10-07T06:45:00.000Z", ended: "2026-10-07T06:45:01.000Z",
      claims: 1, slots: 1, candidates: 1, admit: 0, refuse: 0, send_back: 0, owed: 1, median_seconds_to_admit: null,
    },
    {
      actor: "forge/claude", world: "forge", harness: "claude", started: "2026-10-07T06:40:00.000Z", ended: "2026-10-07T06:51:00.000Z",
      claims: 2, slots: 3, candidates: 3, admit: 2, refuse: 1, send_back: 0, owed: 0, median_seconds_to_admit: 75,
    },
    {
      actor: "forge/codex", world: "forge", harness: "codex", started: "2026-10-07T06:29:58.000Z", ended: "2026-10-07T06:35:00.000Z",
      claims: 1, slots: 1, candidates: 1, admit: 0, refuse: 0, send_back: 1, owed: 0, median_seconds_to_admit: null,
    },
  ],
};

export const DECISIONS = {
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
};

export const ARCHITECTURE = {
  worlds: [
    { world: "commons", forks: 1 },
    { world: "forge", forks: 1 },
  ],
  canonicals: [
    { name: "api", forks: 1 },
    { name: "site", forks: 1 },
    { name: "spec", forks: 0 },
  ],
  forks: [
    { name: "cand--series-trace--forge--codex--w1--s3", canonical: "api", world: "forge", objective: "series-trace", verdict: "ADMIT" },
    { name: "cand--view-trace--commons--script--a1--s2", canonical: "site", world: "commons", objective: "view-trace", verdict: null },
  ],
  operations: [
    { at: "2026-10-07T06:01:00.000Z", kind: "push", from: "authority", to: "spec" },
    { at: "2026-10-07T06:29:58.000Z", kind: "claim", from: "forge", to: "control" },
    { at: "2026-10-07T06:30:00.000Z", kind: "fork", from: "api", to: "cand--series-trace--forge--codex--w1--s3" },
    { at: "2026-10-07T06:33:00.000Z", kind: "push", from: "forge", to: "cand--series-trace--forge--codex--w1--s3" },
    { at: "2026-10-07T06:35:00.000Z", kind: "verdict", from: "authority", to: "cand--series-trace--forge--codex--w1--s3" },
    { at: "2026-10-07T06:45:00.000Z", kind: "claim", from: "commons", to: "control" },
    { at: "2026-10-07T06:45:01.000Z", kind: "fork", from: "site", to: "cand--view-trace--commons--script--a1--s2" },
  ],
};
