import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Cf, DELETE_ORDER, ownsName, prefixFor, run } from "../scripts/uninstall";

const PREFIX = "agent-collab-test";

type Row = Record<string, unknown>;

interface Fake {
  cf: Cf;
  calls: { method: string; path: string }[];
}

// An in-memory account. When sticky is true, deletes answer 202 but nothing leaves.
function fakeAccount(extra: { subs?: Row[]; queues?: Row[] } = {}, sticky = false): Fake {
  const subs: Row[] = [
    { id: "s1", name: `${PREFIX}-site-pushed`, source: { namespace: `${PREFIX}-arena` } },
    { id: "s2", name: `${PREFIX}-api-pushed`, source: { namespace: `${PREFIX}-arena` } },
    { id: "prod1", name: "agent-collab-spec-pushed", source: { namespace: "agent-collab-arena" } },
    ...(extra.subs ?? []),
  ];
  const queues: Row[] = [{ queue_id: "q1", queue_name: `${PREFIX}-events` }, ...(extra.queues ?? [])];
  const workers = new Set([`${PREFIX}-control`, "agent-collab-control"]);
  const repos = new Set([`${PREFIX}-arena/site`, `${PREFIX}-arena/api`, `${PREFIX}-arena/spec`]);
  const namespaces = new Set([`${PREFIX}-arena`, `${PREFIX}-comms`]);
  const calls: Fake["calls"] = [];
  const cf: Cf = async (method, path) => {
    calls.push({ method, path });
    const ok = (result: unknown) => ({ status: 200, json: { success: true, result } });
    if (method === "GET") {
      if (path.startsWith("/event_subscriptions/subscriptions")) return ok(subs);
      if (path.startsWith("/queues")) return ok(queues);
      if (path === "/workers/scripts") return ok([...workers].map((id) => ({ id })));
      const repoList = path.match(/^\/artifacts\/namespaces\/([^/]+)\/repos$/);
      if (repoList) {
        if (!namespaces.has(repoList[1] as string)) return { status: 404, json: {} };
        return ok([...repos].filter((r) => r.startsWith(`${repoList[1]}/`)).map((r) => ({ name: r.split("/")[1] })));
      }
      const ns = path.match(/^\/artifacts\/namespaces\/([^/]+)$/);
      if (ns) return namespaces.has(ns[1] as string) ? ok({}) : { status: 404, json: {} };
      return { status: 500, json: {} };
    }
    if (!sticky) {
      const sub = path.match(/^\/event_subscriptions\/subscriptions\/(.+)$/);
      const queue = path.match(/^\/queues\/(.+)$/);
      const worker = path.match(/^\/workers\/scripts\/([^?]+)/);
      const repo = path.match(/^\/artifacts\/namespaces\/([^/]+)\/repos\/(.+)$/);
      const ns = path.match(/^\/artifacts\/namespaces\/([^/]+)$/);
      if (sub) subs.splice(0, subs.length, ...subs.filter((s) => s.id !== sub[1]));
      if (queue) queues.splice(0, queues.length, ...queues.filter((q) => q.queue_id !== queue[1]));
      if (worker) workers.delete(worker[1] as string);
      if (repo) repos.delete(`${repo[1]}/${repo[2]}`);
      if (ns) namespaces.delete(ns[1] as string);
    }
    return { status: 202, json: {} };
  };
  return { cf, calls };
}

const quiet = { out: () => {}, sleepMs: 0 };
const deletes = (f: Fake): string[] => f.calls.filter((c) => c.method === "DELETE").map((c) => c.path);

describe("prefix guard", () => {
  test("accepts names under the prefix and a hyphen", () => {
    expect(ownsName(PREFIX, "agent-collab-test-arena")).toBe(true);
  });
  test("refuses production names, bare names and a longer word", () => {
    expect(ownsName(PREFIX, "agent-collab-arena")).toBe(false);
    expect(ownsName(PREFIX, "arena")).toBe(false);
    expect(ownsName(PREFIX, "agent-collab-testing")).toBe(false);
    expect(ownsName(PREFIX, "agent-collab-test-")).toBe(false);
    expect(ownsName("", "anything")).toBe(false);
  });
});

describe("prefixFor", () => {
  test("reads RESOURCE_PREFIX from env.test of the repository's own wrangler.jsonc", async () => {
    const text = await Bun.file(join(import.meta.dir, "..", "wrangler.jsonc")).text();
    expect(prefixFor(text, "test")).toBe(PREFIX);
    expect(prefixFor(text, undefined)).toBe("agent-collab");
  });
});

describe("run", () => {
  test("the default run issues only GET calls and exits 0", async () => {
    const f = fakeAccount();
    const code = await run({ prefix: PREFIX, doDelete: false, configDir: "/nonexistent", ...quiet }, f.cf);
    expect(code).toBe(0);
    expect(f.calls.length).toBeGreaterThan(0);
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });

  test("--delete deletes in platform order, re-lists, and exits 0", async () => {
    const f = fakeAccount();
    const lines: string[] = [];
    const code = await run({ prefix: PREFIX, doDelete: true, configDir: "/nonexistent", sleepMs: 0, out: (l) => lines.push(l) }, f.cf);
    expect(code).toBe(0);
    expect(deletes(f)).toEqual([
      "/event_subscriptions/subscriptions/s1",
      "/event_subscriptions/subscriptions/s2",
      "/queues/q1",
      `/workers/scripts/${PREFIX}-control?force=true`,
      `/artifacts/namespaces/${PREFIX}-arena/repos/site`,
      `/artifacts/namespaces/${PREFIX}-arena/repos/api`,
      `/artifacts/namespaces/${PREFIX}-arena/repos/spec`,
      `/artifacts/namespaces/${PREFIX}-arena`,
      `/artifacts/namespaces/${PREFIX}-comms`,
    ]);
    expect(DELETE_ORDER).toEqual(["subscription", "queue", "worker", "repository", "namespace"]);
    const lastDelete = f.calls.map((c) => c.method).lastIndexOf("DELETE");
    expect(f.calls.slice(lastDelete + 1).length).toBeGreaterThan(0);
    expect(f.calls.slice(lastDelete + 1).every((c) => c.method === "GET")).toBe(true);
    expect(lines).toContain("every listed resource is absent");
  });

  test("a resource still present after delete yields exit 1", async () => {
    const f = fakeAccount({}, true);
    const lines: string[] = [];
    const code = await run({ prefix: PREFIX, doDelete: true, configDir: "/nonexistent", sleepMs: 0, out: (l) => lines.push(l) }, f.cf);
    expect(code).toBe(1);
    expect(lines.some((l) => l.endsWith("resources remain"))).toBe(true);
    expect(lines).toContain(`queue ${PREFIX}-events`);
  });

  test("a name outside the prefix is never passed to a DELETE even when the API lists it", async () => {
    const f = fakeAccount({
      subs: [{ id: "evil1", name: "agent-collab-spec-pushed", source: { namespace: `${PREFIX}-arena` } }],
      queues: [{ queue_id: "evilq", queue_name: "agent-collab-events" }],
    });
    const lines: string[] = [];
    const code = await run({ prefix: PREFIX, doDelete: true, configDir: "/nonexistent", sleepMs: 0, out: (l) => lines.push(l) }, f.cf);
    const sent = deletes(f).join("\n");
    expect(sent).not.toContain("evil");
    expect(sent).not.toContain("prod1");
    expect(sent).not.toContain("agent-collab-control");
    expect(lines).toContain("skipped subscription agent-collab-spec-pushed: outside prefix");
    expect(lines).toContain("skipped queue agent-collab-events: outside prefix");
    expect(code).toBe(0);
  });

  test("private files go only with --delete, and the directory only when it is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uninstall-test-"));
    for (const n of ["url", "admin.key", "viewer.key", "env", "notes.txt"]) writeFileSync(join(dir, n), "x\n");
    const listOnly = fakeAccount();
    await run({ prefix: PREFIX, doDelete: false, configDir: dir, ...quiet }, listOnly.cf);
    expect(readdirSync(dir).length).toBe(5);
    const f = fakeAccount();
    expect(await run({ prefix: PREFIX, doDelete: true, configDir: dir, ...quiet }, f.cf)).toBe(0);
    expect(readdirSync(dir)).toEqual(["notes.txt"]);
  });
});
