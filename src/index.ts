import { DurableObject } from "cloudflare:workers";
import { PAGE_HTML } from "./page";
import {
  SCHEMA, KIND_CLASS, isDecisionClass, isDecisionKind, orderRecord, validateControl, validateRecord,
  type DecisionAction, type DecisionClass, type DecisionKind, type DecisionRecord,
} from "./decisions";
import { parseRuns } from "./runs";
import { COMMS_NAMESPACE, COMMS_REPOS, FORGE_TO_OWNER, isCommsRepo, parseMessage, type CommsRepo, type Message } from "./comms";
import { REVIEW_POLICY_V0, contributorOf, deriveStanding, validateEvent, type QualityEvent, type Standing } from "./reputation";

// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
interface Secrets {
  // Admission authority: creates canonicals, mints tokens, records verdicts.
  ADMIN_KEY: string;
  // Submitters, one key per WORLD, as "world=key,world=key". A key reaches claims and reads only,
  // and the world it names is the provenance the claim route writes into every fork name.
  SUBMITTER_KEYS?: string;
  // Account credentials for the one REST call the binding lacks: a pushed-event subscription.
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  // The product is private: /observatory, /site/* and /obs/* need this key, by cookie or bearer.
  VIEWER_KEY?: string;
}
// Resource names, as Worker vars. The defaults are this installation; a second installation in the
// same account sets its own (wrangler.jsonc env "test", ISSUE-00035).
interface Names {
  ARENA_NAMESPACE?: string;
  COMMS_NAMESPACE?: string;
  EVENTS_QUEUE?: string;
  RESOURCE_PREFIX?: string;
}
type AppEnv = Env & Secrets & Names;

const CANONICAL = "canonical";
const SPEC_CANONICAL = "spec";
const arenaNamespace = (env: AppEnv): string => env.ARENA_NAMESPACE ?? "agent-collab-arena";
const commsNamespace = (env: AppEnv): string => env.COMMS_NAMESPACE ?? COMMS_NAMESPACE;
const eventsQueue = (env: AppEnv): string => env.EVENTS_QUEUE ?? "agent-collab-events";
const resourcePrefix = (env: AppEnv): string => env.RESOURCE_PREFIX ?? "agent-collab";
const COORD_ID = "project";

// SPEC 3.2: the candidate repo name is the envelope. Fields: objective, world, harness, agent, session.
const CANDIDATE_NAME = /^cand--[a-z0-9-]{1,40}--[a-z0-9]{1,20}--[a-z0-9]{1,20}--[a-z0-9-]{1,20}--[a-z0-9]{1,16}$/;
const VERDICTS = ["ADMIT", "REFUSE", "SEND_BACK"] as const;
type Verdict = (typeof VERDICTS)[number];

type RepoRow = {
  name: string;
  role: string;
  parent: string | null;
  created_at: string;
};

type EventRow = {
  id: number;
  type: string;
  repo: string;
  ref: string | null;
  after: string | null;
  commits: number;
  message: string | null;
  author: string | null;
  event_ts: string | null;
  received_at: string;
};

type ClaimRow = {
  item: string;
  agent: string;
  claimed_at: string;
};

interface ClaimResult {
  ok: boolean;
  item: string;
  holder: string;
}

// SPEC 5: a claim names its canonical, its objective and its slot count.
type ArenaClaimRow = {
  id: number;
  canonical: string;
  objective: string;
  slots: number;
  claimed_by: string;
  claimed_at: string;
};

// SPEC 3 step 5: the authority's ruling on one candidate tip. History is kept; a sent-back
// candidate earns a second row when it pushes again.
type VerdictRow = {
  id: number;
  candidate: string;
  canonical: string;
  objective: string;
  verdict: Verdict;
  reason: string;
  commit: string;
  note_ref: string | null;
  merge_commit: string | null;
  tag: string | null;
  ruled_at: string;
};

// ISSUE-00021: one Decision Record (src/decisions.ts) and what became of it. Red rows wait for a
// human; green and yellow rows are born decided with no action. `choice` and `note` carry the
// human's answer to the authority, which acts on it and then marks the row acted.
interface DecisionRow {
  id: number;
  class: DecisionClass;
  schema: string;
  status: "open" | "decided";
  subject: string;
  kind: DecisionKind;
  record: DecisionRecord;
  opened_at: string;
  decided_at: string | null;
  action: DecisionAction | null;
  choice: string | null;
  note: string | null;
  actor: "viewer" | "admin" | null;
  acted_at: string | null;
}
type RawDecision = Omit<DecisionRow, "record"> & { record: string };
type DecisionResult = { ok: true; decision: DecisionRow } | { ok: false; status: 400 | 404 | 409; error: string };

const parseDecision = (r: RawDecision): DecisionRow => ({ ...r, record: JSON.parse(r.record) as DecisionRecord });

// Artifacts event envelope, as delivered by a Queues event subscription.
interface ArtifactsEvent {
  type: string;
  source: { type: string; namespace: string; repoName: string };
  payload: {
    ref?: string;
    after?: string;
    totalCommitsCount?: number;
    commits?: { id: string; message: string; author: { name: string } }[];
    repoName?: string;
  };
  metadata: { eventTimestamp: string };
}

// One Coordinator instance holds the project state: objective, repos, events, claims.
// A Durable Object processes one request at a time, so a claim is atomic without locks.
export class Coordinator extends DurableObject<AppEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repos (
        name TEXT PRIMARY KEY, role TEXT NOT NULL, parent TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, repo TEXT NOT NULL,
        ref TEXT, after TEXT, commits INTEGER NOT NULL DEFAULT 0, message TEXT, author TEXT,
        event_ts TEXT, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims (
        item TEXT PRIMARY KEY, agent TEXT NOT NULL, claimed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claim_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, agent TEXT NOT NULL,
        won INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe ON events (type, repo, after, event_ts);
      CREATE TABLE IF NOT EXISTS arena_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT, canonical TEXT NOT NULL, objective TEXT NOT NULL,
        slots INTEGER NOT NULL, claimed_by TEXT NOT NULL, claimed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verdicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, candidate TEXT NOT NULL, canonical TEXT NOT NULL,
        objective TEXT NOT NULL, verdict TEXT NOT NULL, reason TEXT NOT NULL, "commit" TEXT NOT NULL,
        note_ref TEXT, merge_commit TEXT, tag TEXT, ruled_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT NOT NULL, schema TEXT NOT NULL, status TEXT NOT NULL,
        subject TEXT NOT NULL, kind TEXT NOT NULL, record TEXT NOT NULL, opened_at TEXT NOT NULL,
        decided_at TEXT, action TEXT, choice TEXT, note TEXT, actor TEXT, acted_at TEXT);
      CREATE TABLE IF NOT EXISTS quality_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, canonical TEXT NOT NULL,
        contributor TEXT NOT NULL, candidate TEXT NOT NULL, objective TEXT NOT NULL, tip TEXT NOT NULL,
        kind TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT, source TEXT NOT NULL,
        policy TEXT NOT NULL, at TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claim_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, canonical TEXT NOT NULL, contributor TEXT NOT NULL,
        slots INTEGER NOT NULL, at TEXT NOT NULL);
    `);
  }

  // ---- subscribers (ISSUE-00025): GET /api/arena/subscribe reaches here as a WebSocket upgrade.
  // The Hibernation API holds idle sockets at no cost; every recorded change is one JSON line to
  // each socket. Polling stays every client's fallback, so a lost line costs only latency.
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected a WebSocket upgrade", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ kind: "hello", at: new Date().toISOString() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send(JSON.stringify({ kind: "pong", at: new Date().toISOString() }));
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code === 1005 ? 1000 : code, "closed");
  }

  private broadcast(change: Record<string, unknown>): void {
    const ctx = this.ctx as Partial<DurableObjectState>;
    if (typeof ctx.getWebSockets !== "function") return;
    const line = JSON.stringify({ ...change, at: new Date().toISOString() });
    for (const ws of ctx.getWebSockets()) {
      try {
        ws.send(line);
      } catch {
        // A socket that closed between the list and the send: its close handler cleans it up.
      }
    }
  }

  arenaClaim(canonical: string, objective: string, slots: number, claimedBy: string): ArenaClaimRow {
    const now = new Date().toISOString();
    this.sql.exec(
      "INSERT INTO arena_claims (canonical, objective, slots, claimed_by, claimed_at) VALUES (?, ?, ?, ?, ?)",
      canonical, objective, slots, claimedBy, now,
    );
    const row = this.sql.exec<ArenaClaimRow>("SELECT * FROM arena_claims ORDER BY id DESC LIMIT 1").one();
    this.broadcast({ kind: "claim", canonical, objective, slots, claimed_by: claimedBy });
    return row;
  }

  recordVerdict(v: Omit<VerdictRow, "id" | "ruled_at">): VerdictRow {
    this.sql.exec(
      `INSERT INTO verdicts (candidate, canonical, objective, verdict, reason, "commit", note_ref, merge_commit, tag, ruled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.candidate, v.canonical, v.objective, v.verdict, v.reason, v.commit, v.note_ref, v.merge_commit, v.tag,
      new Date().toISOString(),
    );
    const row = this.sql.exec<VerdictRow>("SELECT * FROM verdicts ORDER BY id DESC LIMIT 1").one();
    this.broadcast({ kind: "verdict", candidate: v.candidate, canonical: v.canonical, objective: v.objective, verdict: v.verdict, reason: v.reason, commit: v.commit, tag: v.tag });
    return row;
  }

  // Green and yellow rows are born decided. A red row stays open until a human's control.
  addDecision(cls: DecisionClass, kind: DecisionKind, subject: string, record: DecisionRecord): DecisionRow {
    const now = new Date().toISOString();
    const born = cls === "red";
    this.sql.exec(
      `INSERT INTO decisions (class, schema, status, subject, kind, record, opened_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      cls, SCHEMA, born ? "open" : "decided", subject, kind, JSON.stringify(record), now, born ? null : now,
    );
    const row = parseDecision(this.sql.exec<RawDecision>("SELECT * FROM decisions ORDER BY id DESC LIMIT 1").one());
    this.broadcast({ kind: "decision", id: row.id, class: cls, decision_kind: kind, subject, status: row.status });
    return row;
  }

  listDecisions(): DecisionRow[] {
    return this.sql.exec<RawDecision>("SELECT * FROM decisions ORDER BY id").toArray().map(parseDecision);
  }

  // A human answers an open red row. One request at a time, so two answers cannot both win.
  controlDecision(id: number, body: unknown, actor: "viewer" | "admin"): DecisionResult {
    const row = this.sql.exec<RawDecision>("SELECT * FROM decisions WHERE id = ?", id).toArray()[0];
    if (row === undefined) return { ok: false, status: 404, error: "no such decision" };
    if (row.class !== "red" || row.status !== "open") return { ok: false, status: 409, error: "only an open red decision accepts a control" };
    const control = validateControl(body, JSON.parse(row.record));
    if (!control.ok) return { ok: false, status: 400, error: control.error };
    this.sql.exec(
      "UPDATE decisions SET status = 'decided', action = ?, choice = ?, note = ?, actor = ?, decided_at = ? WHERE id = ?",
      control.action, control.choice, control.note, actor, new Date().toISOString(), id,
    );
    this.broadcast({ kind: "decision", id, class: row.class, decision_kind: row.kind, subject: row.subject, status: "decided", action: control.action, choice: control.choice });
    return { ok: true, decision: parseDecision(this.sql.exec<RawDecision>("SELECT * FROM decisions WHERE id = ?", id).one()) };
  }

  // The authority calls this after it has carried out a decided red row.
  markActed(id: number): DecisionResult {
    const row = this.sql.exec<RawDecision>("SELECT * FROM decisions WHERE id = ?", id).toArray()[0];
    if (row === undefined) return { ok: false, status: 404, error: "no such decision" };
    if (row.status !== "decided" || row.acted_at !== null) return { ok: false, status: 409, error: "only a decided, not yet acted decision can be marked acted" };
    this.sql.exec("UPDATE decisions SET acted_at = ? WHERE id = ?", new Date().toISOString(), id);
    return { ok: true, decision: parseDecision(this.sql.exec<RawDecision>("SELECT * FROM decisions WHERE id = ?", id).one()) };
  }

  setObjective(objective: string): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('objective', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      objective,
    );
  }

  addRepo(name: string, role: string, parent: string | null): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO repos (name, role, parent, created_at) VALUES (?, ?, ?, ?)",
      name, role, parent, new Date().toISOString(),
    );
    this.broadcast({ kind: "repo", name, role, parent });
  }

  // Records one event. Returns false for a message that is not an Artifacts event, so the caller can
  // ack it instead of retrying it forever. Queue delivery is at-least-once; the unique index drops
  // redelivered pushes.
  recordEvent(e: Partial<ArtifactsEvent>): boolean {
    const repo = e.payload?.repoName ?? e.source?.repoName;
    if (typeof e.type !== "string" || typeof repo !== "string") return false;
    const commits = e.payload?.commits;
    const head = commits?.[commits.length - 1];
    this.sql.exec(
      `INSERT OR IGNORE INTO events (type, repo, ref, after, commits, message, author, event_ts, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.type,
      repo,
      e.payload?.ref ?? null,
      e.payload?.after ?? null,
      e.payload?.totalCommitsCount ?? 0,
      head?.message ?? null,
      head?.author?.name ?? null,
      e.metadata?.eventTimestamp ?? null,
      new Date().toISOString(),
    );
    this.broadcast({ kind: "push", repo, ref: e.payload?.ref ?? null, after: e.payload?.after ?? null, message: head?.message ?? null });
    return true;
  }

  claim(item: string, agent: string): ClaimResult {
    const now = new Date().toISOString();
    const inserted = this.sql
      .exec("INSERT INTO claims (item, agent, claimed_at) VALUES (?, ?, ?) ON CONFLICT(item) DO NOTHING", item, agent, now)
      .rowsWritten > 0;
    const holder = this.sql.exec<{ agent: string }>("SELECT agent FROM claims WHERE item = ?", item).one().agent;
    const won = inserted || holder === agent;
    this.sql.exec("INSERT INTO claim_attempts (item, agent, won, at) VALUES (?, ?, ?, ?)", item, agent, won ? 1 : 0, now);
    return { ok: won, item, holder };
  }

  state() {
    const objective =
      this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'objective'").toArray()[0]?.value ?? null;
    const repos = this.sql.exec<RepoRow>("SELECT * FROM repos ORDER BY created_at").toArray();
    const events = this.sql.exec<EventRow>("SELECT * FROM events ORDER BY id DESC LIMIT 500").toArray();
    const claims = this.sql.exec<ClaimRow>("SELECT * FROM claims ORDER BY claimed_at").toArray();
    const attempts = this.sql
      .exec<{ total: number; won: number }>("SELECT COUNT(*) AS total, COALESCE(SUM(won), 0) AS won FROM claim_attempts")
      .one();
    const arenaClaims = this.sql.exec<ArenaClaimRow>("SELECT * FROM arena_claims ORDER BY id").toArray();
    const verdicts = this.sql.exec<VerdictRow>("SELECT * FROM verdicts ORDER BY id").toArray();
    const decisions = this.listDecisions();
    return { objective, repos, events, claims, claimAttempts: attempts, arenaClaims, verdicts, decisions };
  }

  // ---- contributor standing (ISSUE-00034, SPEC 17.5). The quality ledger is append-only and the
  // admin route is its only writer. It is never in state() and never broadcast, because every
  // submitter key reads both; a contributor cannot read its own score (S-001).
  addQualityEvent(input: unknown): { ok: true; inserted: boolean; event: QualityEvent } | { ok: false; error: string; conflict?: true } {
    const v = validateEvent(input);
    if (!v.ok) return v;
    const e = v.event;
    // A correction ref is the PA's name for one fix; reusing it for a different fix is refused, so
    // the second fix is never silently dropped.
    if (e.kind === "correction") {
      const prior = this.sql.exec<{ delta: number; reason: string }>("SELECT delta, reason FROM quality_events WHERE key = ?", e.key).toArray()[0];
      if (prior !== undefined && (prior.delta !== e.delta || prior.reason !== e.reason)) {
        return { ok: false, error: `correction ref ${e.ref ?? ""} already records a different fix; use a new ref`, conflict: true };
      }
    }
    // Check, then insert: one Durable Object call runs alone, so nothing lands between the two.
    // Measured 2026-10-11: the runtime's rowsWritten counts an ignored INSERT OR IGNORE, so it
    // cannot say whether a row was added. The UNIQUE key still refuses a second copy.
    const inserted = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM quality_events WHERE key = ?", e.key).one().n === 0;
    if (inserted) {
      this.sql.exec(
        `INSERT OR IGNORE INTO quality_events (key, canonical, contributor, candidate, objective, tip, kind, delta, reason, ref, source, policy, at, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.key, e.canonical, e.contributor, e.candidate, e.objective, e.tip, e.kind, e.delta, e.reason, e.ref, e.source, e.policy, e.at,
        new Date().toISOString(),
      );
    }
    return { ok: true, inserted, event: e };
  }

  private qualityEvents(canonical: string, contributor: string): QualityEvent[] {
    return this.sql
      .exec<QualityEvent & Record<string, SqlStorageValue>>("SELECT * FROM quality_events WHERE canonical = ? AND contributor = ? ORDER BY id", canonical, contributor)
      .toArray();
  }

  standing(canonical: string, contributor: string): Standing {
    return deriveStanding(this.qualityEvents(canonical, contributor), canonical, contributor);
  }

  listStandings(): Standing[] {
    return this.sql
      .exec<{ canonical: string; contributor: string }>("SELECT DISTINCT canonical, contributor FROM quality_events ORDER BY canonical, contributor")
      .toArray()
      .map((p) => this.standing(p.canonical, p.contributor));
  }

  // Candidates of one contributor on one canonical that still hold a slot: no final verdict, made
  // within the longest claim TTL (one day), and either pushed or made within the default TTL (one
  // hour). A fork never pushed frees its slot after an hour. SEND_BACK keeps a pushed fork open.
  // Reservations of claims still forking count too.
  openCandidates(canonical: string, contributor: string): number {
    const now = Date.now();
    const rows = this.sql.exec<{ name: string; created_at: string; pushed: number }>(
      `SELECT name, created_at,
         EXISTS (SELECT 1 FROM events e WHERE e.repo = repos.name AND e.ref = 'refs/heads/main') AS pushed
       FROM repos WHERE role = 'candidate' AND parent = ? AND created_at >= ?
         AND name NOT IN (SELECT candidate FROM verdicts WHERE verdict IN ('ADMIT', 'REFUSE'))`,
      canonical, new Date(now - 86_400_000).toISOString(),
    ).toArray();
    const hourAgo = new Date(now - 3_600_000).toISOString();
    const forks = rows.filter((r) => contributorOf(r.name) === contributor && (r.pushed === 1 || r.created_at >= hourAgo)).length;
    const reserved = this.sql.exec<{ n: number }>(
      "SELECT COALESCE(SUM(slots), 0) AS n FROM claim_reservations WHERE canonical = ? AND contributor = ? AND at >= ?",
      canonical, contributor, new Date(now - 600_000).toISOString(),
    ).one().n;
    return forks + reserved;
  }

  // Checks the cap and reserves the slots in one Durable Object call, so parallel claims cannot
  // each read the same open count. The claim route releases the reservation once its forks exist;
  // an unreleased one lapses after ten minutes.
  reserveClaim(canonical: string, contributor: string, slots: number): { ok: true; id: number } | { ok: false; over: "slots" | "open"; policy: string } {
    const standing = this.standing(canonical, contributor);
    if (slots > standing.slots) return { ok: false, over: "slots", policy: standing.policy };
    if (this.openCandidates(canonical, contributor) + slots > standing.concurrent) return { ok: false, over: "open", policy: standing.policy };
    this.sql.exec("INSERT INTO claim_reservations (canonical, contributor, slots, at) VALUES (?, ?, ?, ?)", canonical, contributor, slots, new Date().toISOString());
    return { ok: true, id: this.sql.exec<{ id: number }>("SELECT MAX(id) AS id FROM claim_reservations").one().id };
  }

  releaseClaim(id: number): void {
    this.sql.exec("DELETE FROM claim_reservations WHERE id = ?", id);
  }

  // An arena reset clears runs, not contributors' history: quality_events survives it.
  reset(): void {
    this.sql.exec(
      "DELETE FROM meta; DELETE FROM repos; DELETE FROM events; DELETE FROM claims; DELETE FROM claim_attempts; DELETE FROM arena_claims; DELETE FROM verdicts; DELETE FROM decisions;",
    );
  }
}


// Agent and item names become repo names, so keep them to a safe, short alphabet.
function isName(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v);
}

function isSlug(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max && /^[a-z0-9-]+$/.test(v);
}

function coord(env: AppEnv) {
  const ns = env.COORD as DurableObjectNamespace<Coordinator>;
  return ns.get(ns.idFromName(COORD_ID));
}

function bearerEquals(request: Request, key: string): boolean {
  if (key.length === 0) return false;
  const enc = new TextEncoder();
  const given = enc.encode(request.headers.get("authorization") ?? "");
  const expected = enc.encode(`Bearer ${key}`);
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

function isAdmin(request: Request, env: AppEnv): boolean {
  return bearerEquals(request, env.ADMIN_KEY ?? "");
}

// Returns the WORLD a submitter key names, or null. The admin key is also a submitter for every
// world, so the authority can run scripted candidates without a second credential.
function submitterWorld(request: Request, env: AppEnv, claimedWorld: string): string | null {
  if (isAdmin(request, env)) return claimedWorld;
  for (const pair of (env.SUBMITTER_KEYS ?? "").split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const world = pair.slice(0, eq).trim();
    const key = pair.slice(eq + 1).trim();
    if (world === claimedWorld && bearerEquals(request, key)) return world;
  }
  return null;
}

// Errors from the Artifacts binding carry a `code`; return it verbatim so failures are diagnosable.
function errorResponse(err: unknown, status = 500): Response {
  const e = err as { code?: string; message?: string };
  return Response.json({ ok: false, code: e.code ?? null, error: e.message ?? String(err) }, { status });
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// A new subscription drops pushes for about 50 seconds (POC). CONTRACT.md tells submitters to wait.
async function subscribePushed(env: AppEnv, repo: string, namespace = arenaNamespace(env)): Promise<{ ok: boolean; detail: string }> {
  const queueName = eventsQueue(env);
  const token = env.CF_API_TOKEN;
  const account = env.CF_ACCOUNT_ID;
  if (!token || !account) return { ok: false, detail: "worker has no account credentials for subscriptions" };
  const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const queues = (await (await fetch(`${api}/queues?name=${queueName}`, { headers })).json()) as {
    result?: { queue_id: string; queue_name: string }[];
  };
  const queue = queues.result?.find((q) => q.queue_name === queueName);
  if (!queue) return { ok: false, detail: `queue ${queueName} not found` };
  const res = await fetch(`${api}/event_subscriptions/subscriptions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `${resourcePrefix(env)}-${repo}-pushed`,
      enabled: true,
      source: { type: "artifacts.repo", namespace, repo_name: repo },
      destination: { type: "queues.queue", queue_id: queue.queue_id },
      events: ["pushed"],
    }),
  });
  const body = (await res.json()) as { success?: boolean; errors?: { message: string }[] };
  return { ok: body.success === true, detail: body.success ? "subscribed" : (body.errors?.[0]?.message ?? `HTTP ${res.status}`) };
}

// ---- comms (ISSUE-00026)

const COMMS_READ_LIMIT = 100;

// Every message file in one comms repo, oldest first, read through the binding at request time.
// A file that does not parse is listed with its error, so a malformed message is visible, not lost.
async function readComms(env: AppEnv, name: CommsRepo): Promise<{ messages: Message[]; invalid: { path: string; error: string }[]; head: string | null }> {
  using repo = await env.COMMS.get(name);
  const info = await repo.info();
  const head = (await repo.log({ ref: info.defaultBranch, limit: 1 }))[0];
  if (head === undefined) return { messages: [], invalid: [], head: null };
  const dir = (await repo.readTree(head.treeHash))?.find((e) => e.name === "messages" && e.type === "tree");
  const files = dir === undefined ? [] : ((await repo.readTree(dir.hash)) ?? []).filter((e) => e.type === "blob").sort((a, b) => (a.name < b.name ? -1 : 1)).slice(-COMMS_READ_LIMIT);
  const messages: Message[] = [];
  const invalid: { path: string; error: string }[] = [];
  for (const f of files) {
    const path = `messages/${f.name}`;
    const blob = await repo.readBlob(f.hash);
    const parsed = blob === null ? { error: "unreadable blob" } : parseMessage(name, path, await blob.text());
    if ("error" in parsed) invalid.push({ path, error: parsed.error });
    else messages.push(parsed);
  }
  return { messages, invalid, head: head.hash };
}

// A token for one comms repo. The admin key reads and writes both; a submitter key reads both and
// writes forge-to-owner only.
async function handleCommsToken(request: Request, env: AppEnv): Promise<Response> {
  const admin = isAdmin(request, env);
  if (!admin && !isSubmitter(request, env)) return noStore({ ok: false, error: "unauthorized" }, 401);
  const body = (await request.json().catch(() => ({}))) as { repo?: unknown; scope?: unknown; ttl?: unknown };
  if (!isCommsRepo(body.repo)) return noStore({ ok: false, error: `repo must be one of ${COMMS_REPOS.join(", ")}` }, 400);
  const scope = body.scope === "read" ? "read" : "write";
  if (scope === "write" && !admin && body.repo !== FORGE_TO_OWNER) return noStore({ ok: false, error: `a submitter key writes ${FORGE_TO_OWNER} only` }, 403);
  const ttl = Number.isInteger(body.ttl) ? Math.min(Math.max(Number(body.ttl), 60), 14_400) : 3600;
  try {
    using repo = await env.COMMS.get(body.repo);
    const token = await repo.createToken(scope, ttl);
    const info = await repo.info();
    return noStore({ ok: true, repo: info.name, remote: info.remote, scope: token.scope, expiresAt: token.expiresAt, token: token.plaintext });
  } catch (err) {
    return errorResponse(err);
  }
}

// Creates both comms repos when absent and subscribes their pushed events to the Queue. Safe to
// repeat; an existing repo is kept.
async function setupComms(env: AppEnv): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const name of COMMS_REPOS) {
    let created = false;
    try {
      await env.COMMS.create(name, { description: `agent-collab comms: ${name.replaceAll("-", " ")}`, setDefaultBranch: "main" });
      created = true;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code !== "ALREADY_EXISTS") {
        out.push({ name, ok: false, code: e.code ?? null, error: e.message ?? String(err) });
        continue;
      }
    }
    const subscription = await subscribePushed(env, name, commsNamespace(env));
    await coord(env).addRepo(name, "comms", null);
    out.push({ name, ok: true, created, subscription });
  }
  return out;
}

// Headings of a markdown file, skipping fenced code blocks.
function headingsOf(text: string): { level: number; text: string; line: number }[] {
  const out: { level: number; text: string; line: number }[] = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced) return;
    const m = line.match(/^(#{1,4})\s+(.*\S)\s*$/);
    const hashes = m?.[1];
    const text = m?.[2];
    if (hashes !== undefined && text !== undefined) out.push({ level: hashes.length, text, line: i + 1 });
  });
  return out;
}

async function handlePublic(request: Request, env: AppEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (request.method !== "GET") return null;

  if (path === "/api/state") return noStore(await coord(env).state());

  // The spec canonical's SPEC.md, as section headings, read through the binding at request time.
  if (path === "/api/spec") {
    try {
      using repo = await env.ARTIFACTS.get(SPEC_CANONICAL);
      const info = await repo.info();
      const blob = await repo.readFile({ ref: info.defaultBranch, path: "SPEC.md" });
      if (!blob) return noStore({ ok: false, error: "SPEC.md not found in spec canonical" }, 404);
      const text = await blob.text();
      const log = await repo.log({ ref: info.defaultBranch, limit: 1 });
      return noStore({ ok: true, repo: SPEC_CANONICAL, ref: info.defaultBranch, head: log[0]?.hash ?? null, bytes: text.length, headings: headingsOf(text) });
    } catch (err) {
      const e = err as { code?: string };
      return errorResponse(err, e.code === "NOT_FOUND" ? 404 : 500);
    }
  }

  // Raw files from the spec canonical. A submitter reads CONTRACT.md here with no credential.
  // The forge runs (ISSUE-00027), parsed from the spec canonical's RUNS.md for the board.
  if (path === "/api/runs") {
    try {
      using repo = await env.ARTIFACTS.get(SPEC_CANONICAL);
      const info = await repo.info();
      const blob = await repo.readFile({ ref: info.defaultBranch, path: "RUNS.md" });
      if (!blob) return noStore({ ok: false, error: "RUNS.md not found in spec canonical" }, 404);
      const parsed = parseRuns(await blob.text());
      return "error" in parsed ? noStore({ ok: false, error: `RUNS.md: ${parsed.error}` }, 500) : noStore({ ok: true, runs: parsed.runs });
    } catch (err) {
      return errorResponse(err);
    }
  }

  const specFile = path.match(/^\/api\/spec\/file\/(SPEC\.md|CONTRACT\.md|BOOTSTRAP\.md|RUNS\.md|START\.md)$/)?.[1];
  if (specFile) {
    try {
      using repo = await env.ARTIFACTS.get(SPEC_CANONICAL);
      const info = await repo.info();
      const blob = await repo.readFile({ ref: info.defaultBranch, path: specFile });
      if (!blob) return new Response("not found", { status: 404 });
      return new Response(blob, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
    } catch (err) {
      return errorResponse(err, 404);
    }
  }

  // Every Decision Record, red, yellow and green.
  if (path === "/api/arena/decisions") return noStore({ ok: true, decisions: await coord(env).listDecisions() });

  // Both directions of the comms channel, oldest message first in each.
  if (path === "/api/comms") {
    try {
      const [forge, owner] = await Promise.all(COMMS_REPOS.map((r) => readComms(env, r)));
      return noStore({ ok: true, namespace: commsNamespace(env), repos: { [COMMS_REPOS[0]]: forge, [COMMS_REPOS[1]]: owner } });
    } catch (err) {
      return errorResponse(err);
    }
  }

  // One candidate's trail: its pushes and every ruling on it.
  const candidate = path.match(/^\/api\/arena\/candidates\/([A-Za-z0-9._-]+)$/)?.[1];
  if (candidate) {
    const s = await coord(env).state();
    return noStore({
      ok: true,
      candidate,
      repo: s.repos.find((r) => r.name === candidate) ?? null,
      pushes: s.events.filter((e) => e.repo === candidate),
      verdicts: s.verdicts.filter((v) => v.candidate === candidate),
    });
  }

  return null;
}

// Claim slots on a canonical for an objective. SPEC 3 steps 2 and 3 in one call: the claim is
// recorded, the canonical is forked once per slot with a provenance name, a write token is minted
// per fork, and each fork's pushed events are subscribed. The response carries everything a
// submitter needs; nothing is relayed by hand.
async function handleClaim(request: Request, env: AppEnv): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    canonical?: unknown; objective?: unknown; slots?: unknown;
    world?: unknown; harness?: unknown; session?: unknown; agents?: unknown; ttl?: unknown;
  };
  if (!isName(body.canonical)) return noStore({ ok: false, error: "canonical must match [a-z0-9-]{1,40}" }, 400);
  if (!isSlug(body.objective, 40)) return noStore({ ok: false, error: "objective must be a slug of at most 40 chars" }, 400);
  // The candidate name pattern allows no hyphen in world, harness or session; refuse before recording.
  const word = (v: unknown, max: number): v is string => typeof v === "string" && new RegExp(`^[a-z0-9]{1,${max}}$`).test(v);
  if (!word(body.world, 20) || !word(body.harness, 20) || !word(body.session, 16)) {
    return noStore({ ok: false, error: "world and harness (1-20 chars) and session (1-16 chars) are required, [a-z0-9] only" }, 400);
  }
  if (/--/.test(body.objective)) return noStore({ ok: false, error: "objective must not contain --" }, 400);
  const slots = Number(body.slots);
  if (!Number.isInteger(slots) || slots < 1 || slots > 5) return noStore({ ok: false, error: "slots must be an integer from 1 to 5" }, 400);
  const agents = Array.isArray(body.agents) ? body.agents : Array.from({ length: slots }, (_, i) => `s${i + 1}`);
  if (agents.length !== slots || !agents.every((a) => isSlug(a, 20))) {
    return noStore({ ok: false, error: "agents, when given, must be one slug per slot" }, 400);
  }
  const world = submitterWorld(request, env, body.world);
  if (world === null) return noStore({ ok: false, error: "unauthorized: no submitter key for that world" }, 401);
  const ttl = Number.isInteger(body.ttl) ? Math.min(Math.max(Number(body.ttl), 60), 86400) : 3600;

  // SPEC 17.5: a contributor's standing on this canonical caps its slots per claim and its open
  // candidates. The check and the reservation are one Durable Object call, before any fork. The
  // admin key is the PA's own scripted candidates and is not capped. The answer says which limit
  // was hit and what to do, and carries no number derived from the score (S-001).
  let reservation: number | null = null;
  if (!isAdmin(request, env)) {
    const r = await coord(env).reserveClaim(body.canonical, world, slots);
    if (!r.ok) {
      const error = r.over === "slots"
        ? `too many slots for one claim on ${body.canonical} at your current standing; claim fewer`
        : `too many open candidates on ${body.canonical} at your current standing; wait for verdicts, then claim again`;
      return noStore({ ok: false, error, limit: r.over, policy: r.policy }, 429);
    }
    reservation = r.id;
  }

  const claim = await coord(env).arenaClaim(body.canonical, body.objective, slots, `${world}/${body.harness}/${body.session}`);
  const candidates = await Promise.all(
    agents.map(async (agent) => {
      const name = `cand--${body.objective}--${world}--${body.harness}--${agent}--${body.session}`;
      if (!CANDIDATE_NAME.test(name)) return { ok: false, name, error: "candidate name does not match SPEC 3.2" };
      try {
        const subscription = await subscribePushed(env, name);
        using canonical = await env.ARTIFACTS.get(body.canonical as string);
        const forked = await canonical.fork(name, { description: `Candidate for ${body.canonical}: ${body.objective}`, defaultBranchOnly: true });
        await coord(env).addRepo(forked.name, "candidate", body.canonical as string);
        using fork = await env.ARTIFACTS.get(forked.name);
        const token = await fork.createToken("write", ttl);
        return { ok: true, name: forked.name, agent, remote: forked.remote, token: token.plaintext, expiresAt: token.expiresAt, subscription };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return { ok: false, name, agent, code: e.code ?? null, error: e.message ?? String(err) };
      }
    }),
  );
  // The forks now count as open themselves; a failed fork frees its slot with the reservation.
  if (reservation !== null) await coord(env).releaseClaim(reservation);
  return noStore({
    ok: candidates.every((c) => c.ok),
    claim,
    candidates,
    rules: { pushNoSoonerThanSeconds: 60, noteRef: "refs/notes/commits", verdictRef: "refs/notes/admission" },
  });
}

async function handleAdmin(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // Create a canonical by name. Returns its remote and initial write token to the admin caller only.
  if (method === "POST" && (path === "/api/canonicals" || path === "/api/canonical")) {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; description?: unknown; objective?: string };
    const name = isName(body.name) ? body.name : CANONICAL;
    try {
      const created = await env.ARTIFACTS.create(name, {
        description: typeof body.description === "string" ? body.description : `Canonical repository ${name}`,
        setDefaultBranch: "main",
      });
      if (typeof body.objective === "string") await coord(env).setObjective(body.objective);
      await coord(env).addRepo(created.name, "canonical", null);
      return Response.json({ ok: true, name: created.name, remote: created.remote, token: created.token });
    } catch (err) {
      return errorResponse(err);
    }
  }

  // POC route: fork the default canonical once per agent name.
  if (method === "POST" && path === "/api/forks") {
    const body = (await request.json().catch(() => ({}))) as { agents?: unknown };
    const agents = body.agents;
    if (!Array.isArray(agents) || agents.length === 0 || !agents.every(isName)) {
      return Response.json({ ok: false, error: "agents must be a non-empty array of names matching [a-z0-9-]{1,40}" }, { status: 400 });
    }
    const results = await Promise.all(
      agents.map(async (agent) => {
        const name = `fork-${agent}`;
        try {
          using repo = await env.ARTIFACTS.get(CANONICAL);
          const forked = await repo.fork(name, { description: `Fork of ${CANONICAL} for agent ${agent}`, defaultBranchOnly: true });
          await coord(env).addRepo(forked.name, "fork", CANONICAL);
          return { ok: true, agent, name: forked.name, remote: forked.remote };
        } catch (err) {
          const e = err as { code?: string; message?: string };
          return { ok: false, agent, name, code: e.code ?? null, error: e.message ?? String(err) };
        }
      }),
    );
    return Response.json({ ok: results.every((r) => r.ok), forks: results });
  }

  // Mint a write token scoped to one repo.
  const tokenMatch = path.match(/^\/api\/repos\/([A-Za-z0-9._-]+)\/token$/)?.[1];
  if (method === "POST" && tokenMatch) {
    const body = (await request.json().catch(() => ({}))) as { scope?: "read" | "write"; ttl?: number };
    try {
      using repo = await env.ARTIFACTS.get(tokenMatch);
      const token = await repo.createToken(body.scope ?? "write", body.ttl ?? 3600);
      const info = await repo.info();
      return Response.json({ ok: true, repo: info.name, scope: token.scope, expiresAt: token.expiresAt, id: token.id, token: token.plaintext });
    } catch (err) {
      return errorResponse(err);
    }
  }

  // Subscribe one repo's pushed events by name, before or after the repo exists.
  const subMatch = path.match(/^\/api\/repos\/([A-Za-z0-9._-]+)\/subscribe$/)?.[1];
  if (method === "POST" && subMatch) {
    return Response.json({ repo: subMatch, ...(await subscribePushed(env, subMatch)) });
  }

  // Read live repo metadata and recent commits straight from Artifacts (not from the event log).
  const repoMatch = path.match(/^\/api\/repos\/([A-Za-z0-9._-]+)$/)?.[1];
  if (method === "GET" && repoMatch) {
    try {
      using repo = await env.ARTIFACTS.get(repoMatch);
      const info = await repo.info();
      const log = await repo.log({ ref: info.defaultBranch, limit: 10 });
      return Response.json({ ok: true, info, log });
    } catch (err) {
      return errorResponse(err);
    }
  }

  if (method === "GET" && path === "/api/repos") {
    try {
      return Response.json({ ok: true, ...(await env.ARTIFACTS.list({ limit: 100 })) });
    } catch (err) {
      return errorResponse(err);
    }
  }

  // POC route: a work-item claim.
  if (method === "POST" && path === "/api/claims") {
    const body = (await request.json().catch(() => ({}))) as { item?: unknown; agent?: unknown };
    if (!isName(body.item) || !isName(body.agent)) {
      return Response.json({ ok: false, error: "item and agent must match [a-z0-9-]{1,40}" }, { status: 400 });
    }
    return Response.json(await coord(env).claim(body.item, body.agent));
  }

  // The authority's ruling on one candidate tip. The note on the tip is the letter; this row is
  // what the page and a polling submitter read.
  if (method === "POST" && path === "/api/arena/verdicts") {
    const body = (await request.json().catch(() => ({}))) as Partial<VerdictRow>;
    if (typeof body.candidate !== "string" || !CANDIDATE_NAME.test(body.candidate)) return noStore({ ok: false, error: "candidate must be a SPEC 3.2 name" }, 400);
    if (!isName(body.canonical) || !isSlug(body.objective, 40)) return noStore({ ok: false, error: "canonical and objective are required" }, 400);
    if (!VERDICTS.includes(body.verdict as Verdict)) return noStore({ ok: false, error: `verdict must be one of ${VERDICTS.join(", ")}` }, 400);
    if (typeof body.reason !== "string" || body.reason.length === 0 || body.reason.length > 500) return noStore({ ok: false, error: "reason is required (<=500 chars)" }, 400);
    if (typeof body.commit !== "string" || !/^[0-9a-f]{40}$/.test(body.commit)) return noStore({ ok: false, error: "commit must be a 40-char sha" }, 400);
    const opt = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 120 ? v : null);
    const row = await coord(env).recordVerdict({
      candidate: body.candidate,
      canonical: body.canonical,
      objective: body.objective,
      verdict: body.verdict as Verdict,
      reason: body.reason,
      commit: body.commit,
      note_ref: opt(body.note_ref),
      merge_commit: opt(body.merge_commit),
      tag: opt(body.tag),
    });
    return noStore({ ok: true, verdict: row });
  }

  // The authority writes a Decision Record: red waits for a human, yellow and green are recorded.
  if (method === "POST" && path === "/api/arena/decisions") {
    const body = (await request.json().catch(() => ({}))) as { class?: unknown; kind?: unknown; subject?: unknown; record?: unknown };
    if (!isDecisionClass(body.class)) return noStore({ ok: false, error: "class must be red, yellow or green" }, 400);
    if (!isDecisionKind(body.kind) || KIND_CLASS[body.kind] !== body.class) {
      return noStore({ ok: false, error: `kind must be one of ${Object.keys(KIND_CLASS).join(", ")}, and match the class` }, 400);
    }
    if (typeof body.subject !== "string" || !/^[A-Za-z0-9._-]{1,160}$/.test(body.subject)) return noStore({ ok: false, error: "subject must be a candidate name or repo name" }, 400);
    const bad = validateRecord(body.record, body.class);
    if (bad !== null) return noStore({ ok: false, error: `invalid record at ${bad}`, path: bad }, 400);
    return noStore({ ok: true, decision: await coord(env).addDecision(body.class, body.kind, body.subject, orderRecord(body.record)) });
  }

  const actedId = path.match(/^\/api\/arena\/decisions\/(\d{1,9})\/acted$/)?.[1];
  if (method === "POST" && actedId !== undefined) {
    const r = await coord(env).markActed(Number(actedId));
    return r.ok ? noStore({ ok: true, decision: r.decision }) : noStore({ ok: false, error: r.error }, r.status);
  }

  if (method === "POST" && path === "/api/comms/setup") return noStore({ ok: true, repos: await setupComms(env) });

  // ISSUE-00034: the PA records one verified outcome. A replay of the same key stores nothing.
  if (method === "POST" && path === "/api/arena/quality") {
    const body: unknown = await request.json().catch(() => null);
    const r = await coord(env).addQualityEvent(body);
    return r.ok ? noStore({ ok: true, inserted: r.inserted, key: r.event.key }) : noStore({ ok: false, error: r.error }, r.conflict ? 409 : 400);
  }

  // Clears the Coordinator's state only. Artifacts repos and event subscriptions stay in place.
  if (method === "POST" && path === "/api/reset") {
    await coord(env).reset();
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "not found" }, { status: 404 });
}

// The decider's credential for the MVP is the viewer key, by cookie or bearer; the admin key also
// decides. A separate decider key is the noted option (README.md). The cookie is SameSite=Strict,
// so a page on another site cannot post this request with it.
async function handleControl(request: Request, env: AppEnv, id: number): Promise<Response> {
  const actor = isAdmin(request, env) ? "admin" : isViewer(request, env) ? "viewer" : null;
  if (actor === null) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const r = await coord(env).controlDecision(id, body, actor);
  return r.ok ? noStore({ ok: true, decision: r.decision }) : noStore({ ok: false, error: r.error }, r.status);
}

async function handleApi(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const pub = await handlePublic(request, env, url);
  if (pub) return pub;
  if (request.method === "POST" && url.pathname === "/api/arena/claims") return handleClaim(request, env);
  if (request.method === "POST" && url.pathname === "/api/comms/token") return handleCommsToken(request, env);
  const controlId = url.pathname.match(/^\/api\/arena\/decisions\/(\d{1,9})\/control$/)?.[1];
  if (request.method === "POST" && controlId !== undefined) return handleControl(request, env, Number(controlId));
  // ISSUE-00034: standings are for the PA and its human; a submitter key cannot read them.
  if (request.method === "GET" && url.pathname === "/api/arena/standings") {
    if (!isAdmin(request, env) && !isViewer(request, env)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    return noStore({ ok: true, policy: REVIEW_POLICY_V0.version, standings: await coord(env).listStandings() });
  }
  if (!isAdmin(request, env)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handleAdmin(request, env, url);
}

// The product page is the site canonical's index.html, read at request time, so an admitted site
// candidate changes it on the next load. Scripts come only from /site/, never inline.
const SITE_CANONICAL = "site";
const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const SITE_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

async function siteFile(env: AppEnv, path: string): Promise<Response | null> {
  try {
    using repo = await env.ARTIFACTS.get(SITE_CANONICAL);
    const info = await repo.info();
    const blob = await repo.readFile({ ref: info.defaultBranch, path });
    if (!blob) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1);
    return new Response(blob, {
      headers: {
        "content-type": SITE_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
        "content-security-policy": SITE_CSP,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return null;
  }
}

const ACTIVITY = () => new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
const NOT_FOUND = () => new Response("not found", { status: 404 });
const VIEWER_COOKIE = "ac_viewer";

function timingSafeEqualText(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  return b.length > 0 && x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

// The product is not public yet. A viewer proves the key by bearer header or by the cookie that
// /o/<key> sets. Without it every product path is a plain 404, so nothing advertises it.
function isViewer(request: Request, env: AppEnv): boolean {
  const key = env.VIEWER_KEY ?? "";
  if (key.length === 0) return false;
  if (bearerEquals(request, key)) return true;
  const cookie = (request.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${VIEWER_COOKIE}=`));
  return cookie !== undefined && timingSafeEqualText(cookie.slice(VIEWER_COOKIE.length + 1), key);
}

// The public ledger of asks: each SPEC.md ask, its owner-confidence label, and whether it is
// admitted and deployed. It names no product address.
async function asksLedger(env: AppEnv): Promise<unknown> {
  using spec = await env.ARTIFACTS.get(SPEC_CANONICAL);
  const info = await spec.info();
  const blob = await spec.readFile({ ref: info.defaultBranch, path: "SPEC.md" });
  if (!blob) return { ok: false, error: "SPEC.md not found" };
  const asks = headingsOf(await blob.text()).flatMap((h) => {
    const m = h.text.match(/^Ask: (\S+) \(([a-z]+), (HIGH|MEDIUM|LOW)\)/);
    return m ? [{ id: m[1] as string, canonical: m[2] as string, label: m[3] as string }] : [];
  });
  const state = await coord(env).state();
  const apiBuilt = env.API === undefined ? ({} as Record<string, boolean>) : await env.API.fetch("https://api/series")
    .then(async (r) => ((await r.json()) as { series?: Record<string, boolean> }).series ?? {})
    .catch(() => ({}) as Record<string, boolean>);
  const out = [];
  for (const a of asks) {
    const admit = state.verdicts.find((v) => v.canonical === a.canonical && v.objective === a.id && v.verdict === "ADMIT");
    let deployed = false;
    if (admit && a.canonical === "api") deployed = apiBuilt[a.id] === true;
    if (admit && a.canonical === "site") {
      using site = await env.ARTIFACTS.get(SITE_CANONICAL);
      const view = await site.readFile({ ref: (await site.info()).defaultBranch, path: `views/${a.id}.js` });
      deployed = view !== null && /export\s+const\s+built\s*=\s*true/.test(await view.text());
    }
    out.push({ ...a, admitted: admit !== undefined, admitted_from: admit?.candidate ?? null, tag: admit?.tag ?? null, deployed, built: admit !== undefined && deployed });
  }
  return { ok: true, spec_head: info.defaultBranch, asks: out };
}

// Any submitter key, for any world. With the board private, a submitter still reads the spec,
// the asks and its verdicts with its own key.
function isSubmitter(request: Request, env: AppEnv): boolean {
  return (env.SUBMITTER_KEYS ?? "").split(",").some((pair) => {
    const key = pair.slice(pair.indexOf("=") + 1).trim();
    return pair.includes("=") && bearerEquals(request, key);
  });
}

// PUBLIC_BOARD is a plain var: "1" opens the board and the read routes to everyone; anything else
// keeps every route behind a key. The api Worker's service-binding call arrives on host "control",
// which no public request can carry, so the product keeps reading state.
function mayRead(request: Request, env: AppEnv, url: URL): boolean {
  if ((env as { PUBLIC_BOARD?: string }).PUBLIC_BOARD === "1") return true;
  if (url.hostname === "control") return true;
  return isViewer(request, env) || isAdmin(request, env) || isSubmitter(request, env);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    // The login path stays open: a wrong key is a plain 404, a right one sets the viewer cookie.
    if (!url.pathname.startsWith("/o/") && !mayRead(request, env, url)) return NOT_FOUND();
    if (url.pathname === "/api/asks" && request.method === "GET") {
      try {
        return noStore(await asksLedger(env));
      } catch (err) {
        return errorResponse(err);
      }
    }
    // ISSUE-00025: a WebSocket of recorded changes, behind the same keys as /api/state.
    if (url.pathname === "/api/arena/subscribe" && request.method === "GET") return coord(env).fetch(request);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    if (url.pathname === "/" || url.pathname === "/activity") return ACTIVITY();

    const login = url.pathname.match(/^\/o\/([A-Za-z0-9_-]{16,128})$/)?.[1];
    if (login !== undefined) {
      if (!timingSafeEqualText(login, env.VIEWER_KEY ?? "")) return NOT_FOUND();
      return new Response(null, {
        status: 302,
        headers: {
          location: url.searchParams.get("to") === "board" ? "/" : "/observatory",
          "set-cookie": `${VIEWER_COOKIE}=${login}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
          "cache-control": "no-store",
        },
      });
    }
    if (!isViewer(request, env)) return NOT_FOUND();
    if (url.pathname === "/observatory") return (await siteFile(env, "index.html")) ?? NOT_FOUND();
    const sitePath = url.pathname.match(/^\/site\/((?:views\/)?[a-z0-9-]+\.(?:js|css))$/)?.[1];
    if (sitePath !== undefined && request.method === "GET") return (await siteFile(env, sitePath)) ?? NOT_FOUND();
    // The observatory api, deployed from the api canonical, behind a service binding.
    if (url.pathname.startsWith("/obs/") && request.method === "GET" && env.API !== undefined) {
      const target = new URL(url.pathname.slice(4) + url.search, "https://api");
      return env.API.fetch(new Request(target, { method: "GET" }));
    }
    return NOT_FOUND();
  },

  async queue(batch, env): Promise<void> {
    // Ack per message: a malformed message is dropped, a storage failure retries only that message.
    const store = coord(env);
    for (const m of batch.messages) {
      try {
        const recorded = await store.recordEvent(m.body as Partial<ArtifactsEvent>);
        if (!recorded) console.warn("dropped non-Artifacts queue message", m.id);
        m.ack();
      } catch (err) {
        console.error("recordEvent failed; retrying", m.id, err);
        m.retry();
      }
    }
  },
} satisfies ExportedHandler<AppEnv>;
