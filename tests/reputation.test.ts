// Per-PA contributor standing v0 (ISSUE-00034, SPEC 17.5). Written before src/reputation.ts.
// Falsifiers a to e are the MVP tracker's; the rest are the coordinator request's eight cases.
// Run: bun test tests/
import { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import {
  REVIEW_POLICY_V0,
  contributorOf,
  deriveStanding,
  orderReviewQueue,
  outcomeFromRuling,
  validateEvent,
  type PendingCandidate,
  type QualityEvent,
  type Standing,
} from "../src/reputation";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

const FORGE = (agent = "a1", harness = "codex", session = "s1", objective = "series-now"): string =>
  `cand--${objective}--forge--${harness}--${agent}--${session}`;
const NEWBIE = (objective = "series-feed"): string => `cand--${objective}--newbie--claude--a1--s1`;
const TIP = "a".repeat(40);

// A valid authority event, or the reason it is not one.
function ev(input: Record<string, unknown>): QualityEvent {
  const r = validateEvent({ canonical: "api", tip: TIP, reason: "test", source: "authority", ...input });
  if (!r.ok) throw new Error(`invalid test event: ${r.error}`);
  return r.event;
}
const standing = (events: QualityEvent[], contributor = "forge", canonical = "api"): Standing =>
  deriveStanding(events, canonical, contributor);

describe("identity: the verified WORLD is the contributor", () => {
  test("self-declared harness, agent and session never split a standing", () => {
    expect(contributorOf(FORGE("a1", "codex", "s1"))).toBe("forge");
    expect(contributorOf(FORGE("w9", "claude", "zz"))).toBe("forge");
    expect(contributorOf("not-a-candidate")).toBeNull();
  });

  test("falsifier d: an event cannot attribute a candidate to another contributor", () => {
    const r = validateEvent({ canonical: "api", candidate: NEWBIE(), contributor: "forge", tip: TIP, kind: "admitted", reason: "x", source: "authority" });
    expect(r.ok).toBe(false);
  });

  test("falsifier d: a stranger world with an established world's agent names inherits nothing", () => {
    const history = [1, 2, 3, 4].map((i) => ev({ candidate: FORGE(`a${i}`, "codex", "s1", `series-x${i}`), kind: "admitted" }));
    expect(standing(history, "forge").tier).toBe("established");
    const spoof = `cand--series-now--spoof--codex--a1--s1`;
    expect(contributorOf(spoof)).toBe("spoof");
    expect(standing(history, "spoof")).toMatchObject({ score: 0, tier: "new" });
  });

  test("standings are per sovereign: api's history is a stranger to site", () => {
    const history = [1, 2, 3, 4].map((i) => ev({ candidate: FORGE(`a${i}`), kind: "admitted", tip: String(i).repeat(40) }));
    expect(standing(history, "forge", "api").tier).toBe("established");
    expect(standing(history, "forge", "site")).toMatchObject({ score: 0, tier: "new" });
  });
});

describe("only the PA's verified outcomes move a standing", () => {
  test("falsifier a: a contributor-sourced or self-attested report never raises standing", () => {
    expect(validateEvent({ canonical: "api", candidate: FORGE(), tip: TIP, kind: "admitted", reason: "I passed", source: "contributor" }).ok).toBe(false);
    const selfSigned = ev({ candidate: FORGE(), kind: "self_attestation", reason: "signed: all checks pass" });
    expect(standing([selfSigned]).score).toBe(0);
  });

  test("falsifier a: a signed claim the PA verified false lowers standing", () => {
    const s = standing([ev({ candidate: FORGE(), kind: "verified_bad_attestation", reason: "re-ran check: exit 1, attested 0" })]);
    expect(s.score).toBeLessThan(0);
  });

  test("novelty, scope refusals, lost races, duplicates and ask gaps cost nothing", () => {
    const kinds = ["refused_out_of_scope", "lost_race", "duplicate", "send_back_ask_gap"];
    const events = kinds.map((kind, i) => ev({ candidate: FORGE(`a${i}`), kind }));
    expect(standing(events)).toMatchObject({ score: 0 });
  });

  test("check failures are free up to the allowance per objective, then cost one each", () => {
    const fails = (n: number): QualityEvent[] =>
      Array.from({ length: n }, (_, i) => ev({ candidate: FORGE(), kind: "check_failure", tip: String(i).padStart(40, "0") }));
    expect(standing(fails(REVIEW_POLICY_V0.checkFailureAllowance)).score).toBe(0);
    expect(standing(fails(REVIEW_POLICY_V0.checkFailureAllowance + 2)).score).toBe(-2);
  });

  test("unknown kinds are refused", () => {
    expect(validateEvent({ canonical: "api", candidate: FORGE(), tip: TIP, kind: "promote_me", reason: "x", source: "authority" }).ok).toBe(false);
  });

  test("the score is bounded, so no event bans permanently", () => {
    const bad = Array.from({ length: 30 }, (_, i) => ev({ candidate: FORGE(), kind: "verified_bad_attestation", tip: String(i).padStart(40, "0") }));
    expect(standing(bad).score).toBe(REVIEW_POLICY_V0.minScore);
    expect(standing(bad).slots).toBeGreaterThanOrEqual(1);
  });
});

describe("replays and restarts", () => {
  test("two identical outcome events score once", () => {
    const one = ev({ candidate: FORGE(), kind: "admitted" });
    const two = ev({ candidate: FORGE(), kind: "admitted" });
    expect(one.key).toBe(two.key);
    expect(standing([one, two]).score).toBe(1);
  });

  test("falsifier e: re-deriving from the same log in any order gives the same standing and queue", () => {
    const log = [
      ev({ candidate: FORGE("a1"), kind: "admitted" }),
      ev({ candidate: FORGE("a2"), kind: "policy_violation", tip: "b".repeat(40) }),
      ev({ candidate: FORGE("a3"), kind: "admitted", tip: "c".repeat(40) }),
    ];
    const reversed = [...log].reverse();
    expect(standing(reversed)).toEqual(standing(log));
  });
});

describe("corrections", () => {
  test("an accepted correction adjusts the score and needs a reason and a ref", () => {
    const wrong = ev({ candidate: FORGE(), kind: "policy_violation" });
    expect(standing([wrong]).score).toBe(-2);
    const fix = ev({ candidate: FORGE(), kind: "correction", delta: 2, ref: "fix-1", reason: "the reserved path was the PA's own mistake" });
    expect(standing([wrong, fix]).score).toBe(0);
    expect(validateEvent({ canonical: "api", candidate: FORGE(), tip: TIP, kind: "correction", delta: 2, source: "authority", reason: "" }).ok).toBe(false);
    expect(validateEvent({ canonical: "api", candidate: FORGE(), tip: TIP, kind: "correction", delta: 2, source: "authority", reason: "x" }).ok).toBe(false);
    expect(validateEvent({ canonical: "api", candidate: FORGE(), tip: TIP, kind: "correction", delta: 99, ref: "r", source: "authority", reason: "x" }).ok).toBe(false);
  });

  test("every event carries the policy version", () => {
    expect(ev({ candidate: FORGE(), kind: "admitted" }).policy).toBe(REVIEW_POLICY_V0.version);
  });
});

describe("priority and capacity, never admission", () => {
  const pending = (name: string, pushedAt: number): PendingCandidate => {
    const objective = name.split("--")[1] ?? "";
    return { name, canonical: "api", objective, contributor: contributorOf(name) ?? "", pushedAt };
  };
  const lowForge: QualityEvent[] = Array.from({ length: 4 }, (_, i) =>
    ev({ candidate: FORGE(), kind: "verified_bad_attestation", tip: String(i).padStart(40, "0") }));

  test("falsifier b: a poor verified history lowers review priority and keeps the submission", () => {
    const queue = [pending(FORGE("a1", "codex", "s1", "series-a"), 1000), pending(NEWBIE("series-b"), 2000)];
    const ordered = orderReviewQueue(queue, (c, who) => deriveStanding(lowForge, c, who), 3000);
    expect(ordered.map((p) => p.contributor)).toEqual(["newbie", "forge"]);
    expect(ordered).toHaveLength(2);
  });

  test("falsifier c: a new contributor gets a bounded review path and slots", () => {
    const s = standing([], "newbie");
    expect(s.tier).toBe("new");
    expect(s.slots).toBeGreaterThanOrEqual(1);
    expect(s.concurrent).toBeGreaterThanOrEqual(s.slots);
  });

  test("a starved low-standing candidate is reviewed once it waits past the policy's limit", () => {
    const queue = [pending(FORGE("a1", "codex", "s1", "series-a"), 1), pending(NEWBIE("series-b"), REVIEW_POLICY_V0.maxWaitMs)];
    const now = REVIEW_POLICY_V0.maxWaitMs + 1;
    const ordered = orderReviewQueue(queue, (c, who) => deriveStanding(lowForge, c, who), now);
    expect(ordered[0]?.contributor).toBe("forge");
  });

  test("standing never reorders two candidates for the same objective, so it never picks a winner", () => {
    const high: QualityEvent[] = [1, 2, 3, 4].map((i) => ev({ candidate: NEWBIE(`series-x${i}`), kind: "admitted" }));
    const queue = [pending(FORGE("a1", "codex", "s1", "series-now"), 1000), pending(NEWBIE("series-now"), 2000)];
    const ordered = orderReviewQueue(queue, (c, who) => deriveStanding([...high, ...lowForge], c, who), 3000);
    expect(ordered.map((p) => p.contributor)).toEqual(["forge", "newbie"]);
  });

  test("a high standing earns bounded capacity and nothing else", () => {
    const high = Array.from({ length: 20 }, (_, i) => ev({ candidate: FORGE(`a${i}`), kind: "admitted", tip: String(i).padStart(40, "0") }));
    const s = standing(high);
    expect(s.score).toBe(REVIEW_POLICY_V0.maxScore);
    expect(s.slots).toBeLessThanOrEqual(REVIEW_POLICY_V0.slots.established);
    expect(Object.keys(s).sort()).toEqual(["canonical", "concurrent", "contributor", "counted", "policy", "score", "slots", "tier"]);
  });
});

describe("outcomeFromRuling: the authority's verdict reasons map to outcome kinds", () => {
  test.each([
    ["ADMIT", "every check passes; series-now is built", "admitted"],
    ["REFUSE", "scope: changes outside views/view-trace.js: wrangler.jsonc", "policy_violation"],
    ["REFUSE", "objective: series-zz is not an ask on api", "refused_out_of_scope"],
    ["REFUSE", "first: series-now was already admitted from cand--x", "lost_race"],
    ["SEND_BACK", "check: 2 fail. Run bun test ./checks/series-now.test.ts until it passes.", "check_failure"],
    ["SEND_BACK", "hidden: 3 of 40 cases differ.", "check_failure"],
    ["SEND_BACK", "note: no note on refs/notes/commits", "check_failure"],
    ["SEND_BACK", "merge into api conflicts; fetch api main", "lost_race"],
    ["SEND_BACK", "authority error: the reference crashed", "send_back_ask_gap"],
  ])("%s %s -> %s", (verdict, reason, kind) => {
    expect(outcomeFromRuling(verdict, reason)).toBe(kind);
  });
});

// ---- the Durable Object and the routes, against a real SQLite behind SqlStorage's shape.

function fakeStorage(): { sql: { exec: (q: string, ...b: unknown[]) => unknown } } {
  const db = new Database(":memory:");
  return {
    sql: {
      exec(query: string, ...binds: unknown[]) {
        if (binds.length === 0 && query.trim().split(";").filter((s) => s.trim()).length > 1) {
          db.exec(query);
          return { toArray: () => [], one: () => undefined, rowsWritten: 0 };
        }
        const stmt = db.prepare(query);
        const isRead = /^\s*select/i.test(query);
        const result = isRead ? null : stmt.run(...(binds as never[]));
        const rows = isRead ? (stmt.all(...(binds as never[])) as unknown[]) : [];
        return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error("expected one row"); return rows[0]; }, rowsWritten: result?.changes ?? 0 };
      },
    },
  };
}

type Coord = {
  addQualityEvent: (input: unknown) => { ok: boolean; inserted?: boolean; error?: string };
  standing: (canonical: string, contributor: string) => Standing;
  listStandings: () => Standing[];
  state: () => Record<string, unknown>;
  addRepo: (name: string, role: string, parent: string) => void;
};

let make: (storage?: ReturnType<typeof fakeStorage>) => Coord;
beforeAll(async () => {
  const { Coordinator } = (await import("../src/index")) as unknown as { Coordinator: new (ctx: unknown, env: unknown) => Coord };
  make = (storage = fakeStorage()) => new Coordinator({ storage }, {});
});

describe("Coordinator quality ledger", () => {
  const body = (kind: string, tip = TIP): Record<string, unknown> => ({ canonical: "api", candidate: FORGE(), tip, kind, reason: "r", source: "authority" });

  test("append-only and idempotent: a replayed event is stored once", () => {
    const c = make();
    expect(c.addQualityEvent(body("admitted"))).toMatchObject({ ok: true, inserted: true });
    expect(c.addQualityEvent(body("admitted"))).toMatchObject({ ok: true, inserted: false });
    expect(c.standing("api", "forge").score).toBe(1);
  });

  test("falsifier e: a new Coordinator over the same storage keeps the standing", () => {
    const storage = fakeStorage();
    const first = make(storage);
    first.addQualityEvent(body("admitted"));
    first.addQualityEvent(body("admitted", "d".repeat(40)));
    const restarted = make(storage);
    expect(restarted.standing("api", "forge")).toEqual(first.standing("api", "forge"));
    expect(restarted.listStandings()).toHaveLength(1);
  });

  test("standings stay out of /api/state, which every submitter key can read", () => {
    const c = make();
    c.addQualityEvent(body("admitted"));
    expect(JSON.stringify(c.state())).not.toContain("quality");
    expect(Object.keys(c.state())).not.toContain("standings");
  });
});

describe("quality routes", () => {
  const ADMIN = "admin-key-for-tests";
  const VIEWER = "viewer-key-for-tests-0123456789";
  const FORGE_KEY = "forge-submitter-key-for-tests";
  type Worker = { fetch: (r: Request, env: unknown) => Promise<Response> };
  let worker: Worker;
  let env: unknown;
  let coordinator: Coord;
  beforeAll(async () => {
    (crypto.subtle as unknown as { timingSafeEqual: (a: Uint8Array, b: Uint8Array) => boolean }).timingSafeEqual = (a, b) => timingSafeEqual(a, b);
    worker = ((await import("../src/index")) as unknown as { default: Worker }).default;
  });
  const fresh = (): void => {
    coordinator = make();
    env = { ADMIN_KEY: ADMIN, VIEWER_KEY: VIEWER, SUBMITTER_KEYS: `forge=${FORGE_KEY}`, COORD: { idFromName: () => "id", get: () => coordinator } };
  };
  const call = (method: string, path: string, key: string | null, body?: unknown): Promise<Response> =>
    worker.fetch(new Request(`https://x${path}`, {
      method,
      headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
  const event = { canonical: "api", candidate: FORGE(), tip: TIP, kind: "admitted", reason: "r", source: "authority" };

  test("only the admin key writes a quality event; a submitter key cannot self-award", async () => {
    fresh();
    expect((await call("POST", "/api/arena/quality", FORGE_KEY, event)).status).toBe(401);
    expect((await call("POST", "/api/arena/quality", VIEWER, event)).status).toBe(401);
    expect(coordinator.standing("api", "forge").score).toBe(0);
    const ok = await call("POST", "/api/arena/quality", ADMIN, event);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, inserted: true });
    expect((await call("POST", "/api/arena/quality", ADMIN, { ...event, kind: "nonsense" })).status).toBe(400);
  });

  test("the viewer and the admin read standings; a submitter cannot read its own score", async () => {
    fresh();
    await call("POST", "/api/arena/quality", ADMIN, event);
    expect((await call("GET", "/api/arena/standings", FORGE_KEY)).status).toBe(401);
    const viewer = await call("GET", "/api/arena/standings", VIEWER);
    expect(viewer.status).toBe(200);
    expect(await viewer.json()).toMatchObject({ ok: true, policy: REVIEW_POLICY_V0.version, standings: [{ contributor: "forge", score: 1 }] });
    expect((await call("GET", "/api/arena/standings", ADMIN)).status).toBe(200);
  });

  test("the claim route refuses slots above the contributor's standing, before any fork", async () => {
    fresh();
    const claim = { canonical: "api", objective: "series-now", world: "forge", harness: "codex", session: "s1", slots: REVIEW_POLICY_V0.slots.new + 1 };
    const res = await call("POST", "/api/arena/claims", FORGE_KEY, claim);
    expect(res.status).toBe(429);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: false, limit: "slots", policy: REVIEW_POLICY_V0.version });
    // S-001: no number derived from the score reaches the submitter.
    expect(JSON.stringify(json)).not.toMatch(/\d+ (slots|open)|"(cap|open|concurrent|score|tier)"/);
  });

  test("the claim cap counts open candidates of that contributor on that canonical", async () => {
    fresh();
    for (let i = 0; i < REVIEW_POLICY_V0.concurrent.new; i++) coordinator.addRepo(FORGE(`a${i}`, "codex", "s1", `series-o${i}`), "candidate", "api");
    const claim = { canonical: "api", objective: "series-now", world: "forge", harness: "codex", session: "s1", slots: 1 };
    const res = await call("POST", "/api/arena/claims", FORGE_KEY, claim);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, limit: "open" });
  });

  test("a correction ref reused for a different fix is refused with 409", async () => {
    fresh();
    const fix = { ...event, kind: "correction", delta: 2, ref: "fix-1", reason: "PA error" };
    expect((await call("POST", "/api/arena/quality", ADMIN, fix)).status).toBe(200);
    expect(await (await call("POST", "/api/arena/quality", ADMIN, fix)).json()).toMatchObject({ ok: true, inserted: false });
    expect((await call("POST", "/api/arena/quality", ADMIN, { ...fix, delta: 3 })).status).toBe(409);
  });
});

describe("review fixes (independent review, 2026-10-11)", () => {
  type CoordX = Coord & {
    reserveClaim: (canonical: string, contributor: string, slots: number) => { ok: boolean; id?: number; over?: string };
    releaseClaim: (id: number) => void;
    openCandidates: (canonical: string, contributor: string) => number;
  };

  test("parallel claims cannot share one open count: the reservation counts at once", () => {
    const c = make() as CoordX;
    const cap = REVIEW_POLICY_V0.concurrent.new;
    const per = REVIEW_POLICY_V0.slots.new;
    const results = Array.from({ length: cap }, () => c.reserveClaim("api", "forge", per));
    expect(results.filter((r) => r.ok)).toHaveLength(Math.floor(cap / per));
    expect(results.at(-1)).toMatchObject({ ok: false, over: "open" });
  });

  test("a released reservation frees its slots", () => {
    const c = make() as CoordX;
    const r = c.reserveClaim("api", "forge", 2);
    expect(c.openCandidates("api", "forge")).toBe(2);
    c.releaseClaim(r.id ?? -1);
    expect(c.openCandidates("api", "forge")).toBe(0);
  });

  test("a fork never pushed stops holding a slot after an hour; a pushed fork keeps it", () => {
    const storage = fakeStorage();
    const c = make(storage) as CoordX;
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const db = storage.sql;
    db.exec("INSERT INTO repos (name, role, parent, created_at) VALUES (?, 'candidate', 'api', ?)", FORGE("a1"), old);
    db.exec("INSERT INTO repos (name, role, parent, created_at) VALUES (?, 'candidate', 'api', ?)", FORGE("a2"), old);
    db.exec("INSERT INTO events (type, repo, ref, after, commits, received_at) VALUES ('pushed', ?, 'refs/heads/main', ?, 1, ?)", FORGE("a2"), TIP, old);
    expect(c.openCandidates("api", "forge")).toBe(1);
  });

  test("a sandbox timeout or crash is the PA's gap, not the contributor's failure", () => {
    expect(outcomeFromRuling("SEND_BACK", "check: checks/series-now.test.ts: 0 pass, ? fail (exit 124). Run bun test")).toBe("send_back_ask_gap");
    expect(outcomeFromRuling("SEND_BACK", "check: checks/series-now.test.ts: 0 pass, ? fail (exit 137). Run bun test")).toBe("send_back_ask_gap");
    expect(outcomeFromRuling("SEND_BACK", "check: checks/series-now.test.ts: 3 pass, 2 fail (exit 1). Run bun test")).toBe("check_failure");
  });

  test("a candidate with no recorded push is not starved, so it cannot jump the queue", () => {
    const now = 10 * REVIEW_POLICY_V0.maxWaitMs;
    const queue: PendingCandidate[] = [
      { name: NEWBIE("series-b"), canonical: "api", objective: "series-b", contributor: "newbie", pushedAt: now - 1000 },
      { name: FORGE("a1", "codex", "s1", "series-a"), canonical: "api", objective: "series-a", contributor: "forge", pushedAt: 0 },
    ];
    const low = Array.from({ length: 4 }, (_, i) => ev({ candidate: FORGE(), kind: "verified_bad_attestation", tip: String(i).padStart(40, "0") }));
    const ordered = orderReviewQueue(queue, (c, who) => deriveStanding(low, c, who), now);
    expect(ordered[0]?.contributor).toBe("newbie");
  });
});
