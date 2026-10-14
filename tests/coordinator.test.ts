// The Coordinator's decisions table against a real SQLite (bun:sqlite) behind the Durable Object's
// SqlStorage shape. ISSUE-00021. Run: bun test tests/
import { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { ACTIONS } from "../src/decisions";
import { admissionErrorRecord, reservedPathRecord, sendBackRecord } from "../scripts/records";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

// Just enough of SqlStorage.exec: rows by toArray/one, rowsWritten for writes.
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
        const rows = isRead ? (stmt.all(...(binds as never[])) as unknown[]) : (stmt.run(...(binds as never[])), []);
        return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error("expected one row"); return rows[0]; }, rowsWritten: isRead ? 0 : 1 };
      },
    },
  };
}

type Coord = {
  addDecision: (cls: string, kind: string, subject: string, record: unknown) => { id: number; status: string; decided_at: string | null; action: string | null; record: { recommendation: { choice: string } } };
  controlDecision: (id: number, body: unknown, actor: string) => { ok: boolean; status?: number; error?: string; decision?: { status: string; action: string; choice: string | null; note: string | null; actor: string } };
  markActed: (id: number) => { ok: boolean; status?: number; decision?: { acted_at: string | null } };
  listDecisions: () => { id: number }[];
  state: () => { decisions: { id: number }[] };
  reset: () => void;
};

let make: () => Coord;
beforeAll(async () => {
  const { Coordinator } = (await import("../src/index")) as unknown as { Coordinator: new (ctx: unknown, env: unknown) => Coord };
  make = () => new Coordinator({ storage: fakeStorage() }, {});
});

const CAND = "cand--view-trace--commons--script--a1--s2";
const red = () => reservedPathRecord({ candidate: CAND, askFile: "views/view-trace.js", paths: ["wrangler.jsonc"], reason: "scope: changes outside views/view-trace.js: wrangler.jsonc" });

describe("Coordinator decisions", () => {
  test("a red row is born open; yellow is born decided with no action", () => {
    const c = make();
    const r = c.addDecision("red", "reserved_path", CAND, red());
    const y = c.addDecision("yellow", "send_back", CAND, sendBackRecord({ candidate: CAND, reason: "check failed" }));
    expect([r.id, r.status, r.decided_at, r.action]).toEqual([1, "open", null, null]);
    expect([y.id, y.status, y.action]).toEqual([2, "decided", null]);
    expect(y.decided_at).not.toBeNull();
    expect(r.record.recommendation.choice).toBe("refuse");
  });

  test("state() carries every row with the record parsed", () => {
    const c = make();
    c.addDecision("red", "reserved_path", CAND, red());
    expect(c.state().decisions).toHaveLength(1);
    expect(c.listDecisions()[0]).toMatchObject({ id: 1, record: { why_now: { summary: expect.stringContaining("wrangler.jsonc") } } });
  });

  test("a control decides an open red row once, with the actor, the choice and the note", () => {
    const c = make();
    c.addDecision("red", "reserved_path", CAND, red());
    const bad = c.controlDecision(1, { action: "choose_alternative" }, "viewer");
    expect(bad).toMatchObject({ ok: false, status: 400 });
    const ok = c.controlDecision(1, { action: "choose_alternative", choice: "waive", note: "go" }, "viewer");
    expect(ok.decision).toMatchObject({ status: "decided", action: "choose_alternative", choice: "waive", note: "go", actor: "viewer" });
    expect(c.controlDecision(1, { action: "stop" }, "admin")).toMatchObject({ ok: false, status: 409 });
    expect(c.controlDecision(99, { action: "stop" }, "admin")).toMatchObject({ ok: false, status: 404 });
  });

  test("a yellow row accepts no control", () => {
    const c = make();
    c.addDecision("yellow", "send_back", CAND, sendBackRecord({ candidate: CAND, reason: "x" }));
    expect(c.controlDecision(1, { action: "stop" }, "admin")).toMatchObject({ ok: false, status: 409 });
  });

  test("all nine actions are accepted on an admission-error row", () => {
    const c = make();
    ACTIONS.forEach((a, i) => {
      c.addDecision("red", "admission_error", CAND, admissionErrorRecord({ candidate: CAND, key: `k${i}`, error: "boom" }));
      const body = a === "choose_alternative" ? { action: a, choice: "retry" } : { action: a };
      expect(c.controlDecision(i + 1, body, "viewer")).toMatchObject({ ok: true });
    });
  });

  test("markActed needs a decided row and works once", () => {
    const c = make();
    c.addDecision("red", "reserved_path", CAND, red());
    expect(c.markActed(1)).toMatchObject({ ok: false, status: 409 });
    c.controlDecision(1, { action: "approve" }, "admin");
    expect(c.markActed(1).decision?.acted_at).not.toBeNull();
    expect(c.markActed(1)).toMatchObject({ ok: false, status: 409 });
  });

  test("reset clears the decisions", () => {
    const c = make();
    c.addDecision("red", "reserved_path", CAND, red());
    c.reset();
    expect(c.listDecisions()).toEqual([]);
  });
});

// The routes, through the Worker's own fetch handler, with the Durable Object stubbed by a Coordinator.
describe("decision routes", () => {
  const ADMIN = "admin-key-for-tests";
  const VIEWER = "viewer-key-for-tests-0123456789";
  type Worker = { fetch: (r: Request, env: unknown) => Promise<Response> };
  let worker: Worker;
  let env: unknown;
  beforeAll(async () => {
    // The Workers runtime has crypto.subtle.timingSafeEqual; Bun does not.
    (crypto.subtle as unknown as { timingSafeEqual: (a: Uint8Array, b: Uint8Array) => boolean }).timingSafeEqual = (a, b) => timingSafeEqual(a, b);
    worker = ((await import("../src/index")) as unknown as { default: Worker }).default;
  });
  const fresh = (): void => {
    const c = make();
    env = { ADMIN_KEY: ADMIN, VIEWER_KEY: VIEWER, COORD: { idFromName: () => "id", get: () => c } };
  };
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Response> =>
    worker.fetch(new Request(`https://x${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const admin = { authorization: `Bearer ${ADMIN}` };
  const post = { class: "red", kind: "reserved_path", subject: CAND, record: red() };

  test("POST needs the admin key and a valid record, and names the first failing path", async () => {
    fresh();
    expect((await call("POST", "/api/arena/decisions", { authorization: `Bearer ${VIEWER}` }, post)).status).toBe(401);
    const broken = { ...post, record: { ...red(), evidence: { summary: "" } } };
    const bad = await call("POST", "/api/arena/decisions", admin, broken);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, path: "record.evidence.summary" });
    expect((await call("POST", "/api/arena/decisions", admin, { ...post, kind: "send_back" })).status).toBe(400);
    expect((await call("POST", "/api/arena/decisions", admin, post)).status).toBe(200);
  });

  test("GET returns every row to any key; /api/state carries them", async () => {
    fresh();
    await call("POST", "/api/arena/decisions", admin, post);
    const list = (await (await call("GET", "/api/arena/decisions", { authorization: `Bearer ${VIEWER}` })).json()) as { ok: boolean; decisions: { id: number }[] };
    expect([list.ok, list.decisions.length]).toEqual([true, 1]);
    expect((await call("GET", "/api/arena/decisions", {})).status).toBe(404);
    const state = (await (await call("GET", "/api/state", admin)).json()) as { decisions: unknown[] };
    expect(state.decisions).toHaveLength(1);
  });

  test("the control takes the viewer cookie or bearer, or admin, and refuses everyone else", async () => {
    fresh();
    for (let i = 0; i < 3; i++) await call("POST", "/api/arena/decisions", admin, post);
    expect((await call("POST", "/api/arena/decisions/1/control", { cookie: "ac_viewer=wrong-wrong-wrong-wrong" }, { action: "stop" })).status).toBe(404);
    const viaCookie = await call("POST", "/api/arena/decisions/1/control", { cookie: `ac_viewer=${VIEWER}` }, { action: "approve" });
    expect(viaCookie.status).toBe(200);
    expect(await viaCookie.json()).toMatchObject({ ok: true, decision: { status: "decided", action: "approve", actor: "viewer" } });
    const viaAdmin = await call("POST", "/api/arena/decisions/2/control", admin, { action: "choose_alternative", choice: "waive" });
    expect(await viaAdmin.json()).toMatchObject({ decision: { actor: "admin", choice: "waive" } });
    const viaBearer = await call("POST", "/api/arena/decisions/3/control", { authorization: `Bearer ${VIEWER}` }, { action: "defer" });
    expect(await viaBearer.json()).toMatchObject({ decision: { actor: "viewer" } });
    expect((await call("POST", "/api/arena/decisions/1/control", { cookie: `ac_viewer=${VIEWER}` }, { action: "stop" })).status).toBe(409);
  });

  test("acted is admin only and follows a decision", async () => {
    fresh();
    await call("POST", "/api/arena/decisions", admin, post);
    expect((await call("POST", "/api/arena/decisions/1/acted", admin, {})).status).toBe(409);
    await call("POST", "/api/arena/decisions/1/control", admin, { action: "reject" });
    expect((await call("POST", "/api/arena/decisions/1/acted", { authorization: `Bearer ${VIEWER}` }, {})).status).toBe(401);
    expect(await (await call("POST", "/api/arena/decisions/1/acted", admin, {})).json()).toMatchObject({ ok: true, decision: { acted_at: expect.any(String) } });
  });
});
