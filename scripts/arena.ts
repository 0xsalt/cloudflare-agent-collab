// Arena driver for SPEC 14.1.1. Subcommands:
//   canonicals   subscribe, create and seed the canonicals spec, api and site
//   claim        claim three slots on api for feed-iso8601, as world commons, harness script
//   candidates   wait out the warm-up, then push three scripted candidates and their notes
//   admit        rule on every candidate, write admission notes, merge the winner, tag a release
//   verify       print the arena state and the push events by ref
//   publish-contract   push this repository's CONTRACT.md to the spec canonical
//
// The candidates follow CONTRACT.md's quickstart and nothing else. Admission is the authority's
// side and uses the admin key. Clones live under .workdirs/, which is gitignored.
//
// Environment: CLOUDFLARE_ACCOUNT_ID (redaction only), AGENT_COLLAB_URL,
// AGENT_COLLAB_ADMIN_KEY_FILE. Tokens and keys are never printed.
//
//   sh scripts/cf-env.sh bun --env-file=<private env file> scripts/arena.ts <subcommand>

import { $ } from "bun";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WORKDIR = join(ROOT, ".workdirs", "arena");
const CLAIM_FILE = join(WORKDIR, "claim.json");
const CONTRACT_ID = "agent-collab/0.1";
const WARM_UP_MS = 60_000;

const CANONICAL = "api";
const OBJECTIVE = "feed-iso8601";
const RELEASE_TAG = "v0.1.0";

// CONTRACT.md "Reserved paths". The authority owns these files.
const RESERVED: Record<string, readonly string[]> = {
  api: ["wrangler.jsonc", "feed.test.ts", "package.json", "bunfig.toml"],
  site: ["wrangler.jsonc", "package.json", "bunfig.toml"],
  spec: ["CONTRACT.md"],
};
// A change to these could alter what `bun test` executes, so tests are skipped when they change.
const EXEC_CONFIG = ["package.json", "bunfig.toml"];

// Canonical seeds: repo path -> source path in this repository.
const SEEDS: Record<string, Record<string, string>> = {
  spec: { "SPEC.md": "SPEC.md", "CONTRACT.md": "CONTRACT.md" },
  api: {
    "feed.ts": "canonicals/api/feed.ts",
    "feed.test.ts": "canonicals/api/feed.test.ts",
    "wrangler.jsonc": "canonicals/api/wrangler.jsonc",
    "README.md": "canonicals/api/README.md",
  },
  site: { "src/page.ts": "src/page.ts" },
};
const DESCRIPTIONS: Record<string, string> = {
  spec: "agent-collab spec canonical: SPEC.md and CONTRACT.md",
  api: "agent-collab api canonical: the observatory feed Worker",
  site: "agent-collab site canonical: the observatory page",
};

const accountId = need("CLOUDFLARE_ACCOUNT_ID");
const baseUrl = need("AGENT_COLLAB_URL");
const adminKey = (await Bun.file(expandHome(need("AGENT_COLLAB_ADMIN_KEY_FILE"))).text()).trim();

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`missing environment variable ${name}`);
  return v;
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function redact(s: string): string {
  return s
    .replaceAll(accountId, "<ACCT>")
    .replace(/art_v\d+_[0-9A-Za-z_]+(\?expires=\d+)?/g, "art_<redacted>");
}

function log(label: string, value?: unknown): void {
  const text = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  console.log(redact(`${label} ${text}`.trim()));
}

async function api(path: string, body?: unknown, key: string | null = adminKey): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}, not JSON` }))) as Record<string, unknown>;
  return { status: res.status, ...json };
}

async function mintToken(repo: string): Promise<string> {
  const r = await api(`/api/repos/${repo}/token`, { scope: "write", ttl: 3600 });
  if (r.ok !== true) throw new Error(redact(`token mint failed for ${repo}: ${JSON.stringify(r)}`));
  return String(r.token);
}

async function repoInfo(repo: string): Promise<{ remote: string; head: string | null }> {
  const r = (await api(`/api/repos/${repo}`)) as { ok?: boolean; info?: { remote?: string }; log?: { hash: string }[] };
  if (r.ok !== true || typeof r.info?.remote !== "string") throw new Error(redact(`repo info failed for ${repo}: ${JSON.stringify(r)}`));
  return { remote: r.info.remote, head: r.log?.[0]?.hash ?? null };
}

function authHeader(token: string): string {
  return `http.extraHeader=Authorization: Bearer ${token}`;
}

async function sh(cmd: ReturnType<typeof $>, what: string): Promise<string> {
  const r = await cmd.nothrow().quiet();
  if (r.exitCode !== 0) throw new Error(redact(`${what} failed (exit ${r.exitCode}): ${r.stderr.toString().trim()}`));
  return r.stdout.toString().trim();
}

async function identity(dir: string, name: string, email: string): Promise<void> {
  await sh($`git -C ${dir} config user.name ${name}`, "git config user.name");
  await sh($`git -C ${dir} config user.email ${email}`, "git config user.email");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- canonicals

async function seedCanonical(name: string): Promise<void> {
  const { remote, head } = await repoInfo(name);
  if (head !== null) {
    log(`seed ${name}: already has commits, head`, head);
    return;
  }
  const token = await mintToken(name);
  const dir = join(WORKDIR, "seed", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await sh($`git -C ${dir} init --quiet -b seed`, "git init");
  await identity(dir, `${name} admission authority`, `${name}-authority@agent-collab.invalid`);
  for (const [dest, src] of Object.entries(SEEDS[name] ?? {})) {
    await mkdir(join(dir, dest, ".."), { recursive: true });
    await cp(join(ROOT, src), join(dir, dest));
  }
  await sh($`git -C ${dir} add -A`, "git add");
  await sh($`git -C ${dir} commit --quiet -m ${`Seed ${name} canonical`}`, "git commit");
  await sh($`git -C ${dir} -c ${authHeader(token)} push --quiet ${remote} HEAD:refs/heads/main`, `push seed ${name}`);
  log(`seed ${name}: pushed`, await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse"));
}

async function canonicals(): Promise<void> {
  const names = Object.keys(SEEDS);
  for (const name of names) {
    log(`subscribe ${name}:`, await api(`/api/repos/${name}/subscribe`, {}));
    const created = await api("/api/canonicals", { name, description: DESCRIPTIONS[name] });
    log(`create ${name}:`, { ok: created.ok, name: created.name, code: created.code ?? null, error: created.error ?? null });
  }
  log(`waiting ${WARM_UP_MS / 1000}s for the push subscriptions to warm up`);
  await sleep(WARM_UP_MS);
  for (const name of names) await seedCanonical(name);
}

// ---------------------------------------------------------------- claim

interface ClaimCandidate {
  readonly ok: boolean;
  readonly name: string;
  readonly agent: string;
  readonly remote: string;
  readonly token: string;
  readonly error?: string;
}
interface ClaimFile {
  readonly ok: boolean;
  readonly claim: { id: number; canonical: string; objective: string; claimed_at: string };
  readonly candidates: readonly ClaimCandidate[];
  readonly session: string;
  readonly receivedAt: string;
}

async function claim(): Promise<void> {
  if (await Bun.file(CLAIM_FILE).exists()) throw new Error(`${CLAIM_FILE} exists; one claim per run`);
  const session = crypto.getRandomValues(new Uint8Array(2)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  const body = {
    canonical: CANONICAL, objective: OBJECTIVE, slots: 3, world: "commons", harness: "script",
    session, agents: ["a1", "a2", "a3"], ttl: 7200,
  };
  const r = await api("/api/arena/claims", body);
  const file = { ...r, session, receivedAt: new Date().toISOString() };
  await mkdir(WORKDIR, { recursive: true });
  await Bun.write(CLAIM_FILE, JSON.stringify(file, null, 2));
  await chmod(CLAIM_FILE, 0o600);
  const c = r as unknown as ClaimFile;
  log("claim:", { ok: r.ok, status: r.status, claim: c.claim, names: c.candidates?.map((x) => `${x.name} ${x.ok ? "ok" : x.error}`) });
}

async function readClaim(): Promise<ClaimFile> {
  return (await Bun.file(CLAIM_FILE).json()) as ClaimFile;
}

// ---------------------------------------------------------------- candidates

const ISO_FIX_ITEMS = (src: string): string =>
  src.replace("published: new Date(e.received_at).toUTCString()", "published: new Date(e.received_at).toISOString()");
const ISO_FIX_ALL = (src: string): string => ISO_FIX_ITEMS(src).replace("updated: now.toUTCString()", "updated: now.toISOString()");

interface Script {
  readonly agent: string;
  readonly prompt: string;
  readonly message: string;
  readonly reason: string;
  readonly edit: (dir: string) => Promise<void>;
}

async function editFile(path: string, fn: (s: string) => string): Promise<void> {
  const before = await Bun.file(path).text();
  const after = fn(before);
  if (after === before) throw new Error(`scripted edit changed nothing in ${path}`);
  await Bun.write(path, after);
}

const SCRIPTS: readonly Script[] = [
  {
    agent: "a1",
    prompt: "Make every timestamp the feed emits ISO-8601. Run bun test before pushing.",
    message: "Feed timestamps are ISO-8601",
    reason: "feed.test.ts 'feed timestamps are ISO-8601' fails: feed.ts writes updated and published with toUTCString(). Both now use toISOString().",
    edit: (dir) => editFile(join(dir, "feed.ts"), ISO_FIX_ALL),
  },
  {
    agent: "a2",
    prompt: "Make every timestamp the feed emits ISO-8601, and pin the Worker to a newer compatibility date.",
    message: "Feed timestamps are ISO-8601; bump compatibility date",
    reason: "feed.test.ts 'feed timestamps are ISO-8601' fails: feed.ts writes toUTCString(). Both now use toISOString(); compatibility date bumped while here.",
    edit: async (dir) => {
      await editFile(join(dir, "feed.ts"), ISO_FIX_ALL);
      await editFile(join(dir, "wrangler.jsonc"), (s) => s.replace('"2026-10-05"', '"2026-10-07"'));
    },
  },
  {
    agent: "a3",
    prompt: "Make feed item timestamps ISO-8601.",
    message: "Feed item timestamps are ISO-8601",
    reason: "feed.test.ts 'feed timestamps are ISO-8601' fails on item published times. Items now use toISOString().",
    edit: (dir) => editFile(join(dir, "feed.ts"), ISO_FIX_ITEMS),
  },
];

// CONTRACT.md quickstart, steps 6 to 9, for one slot.
async function runCandidate(c: ClaimCandidate, script: Script, session: string): Promise<Record<string, unknown>> {
  const auth = authHeader(c.token);
  const dir = join(WORKDIR, "candidates", c.name);
  await rm(dir, { recursive: true, force: true });
  await sh($`git -c ${auth} clone --quiet ${c.remote} ${dir}`, `clone ${c.name}`);
  const base = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse base");
  await identity(dir, `agent ${script.agent}`, `${script.agent}@commons.agent-collab.invalid`);
  await sh($`git -C ${dir} checkout --quiet -b candidate`, "checkout");
  await script.edit(dir);
  const test = await $`bun test`.cwd(dir).nothrow().quiet();
  await sh($`git -C ${dir} commit --quiet -am ${script.message}`, "commit");
  const tip = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse tip");
  await sh($`git -C ${dir} -c ${auth} push --quiet ${c.remote} HEAD:main`, `push ${c.name}`);
  const note = {
    contract: CONTRACT_ID,
    canonical: CANONICAL,
    objective: OBJECTIVE,
    base,
    run_id: session,
    prompt: script.prompt,
    reason: script.reason,
    checks: { "bun test": test.exitCode === 0 ? "pass" : "fail" },
    world: "commons",
    harness: "script",
    agent: script.agent,
  };
  const notePath = join(WORKDIR, "candidates", `${c.name}.note.json`);
  await Bun.write(notePath, JSON.stringify(note, null, 2));
  await sh($`git -C ${dir} notes add -F ${notePath} HEAD`, "notes add");
  await sh($`git -C ${dir} -c ${auth} push --quiet ${c.remote} refs/notes/commits`, `push notes ${c.name}`);
  return { name: c.name, base, tip, bunTest: note.checks["bun test"] };
}

async function candidates(): Promise<void> {
  const file = await readClaim();
  const wait = Date.parse(file.receivedAt) + WARM_UP_MS - Date.now();
  if (wait > 0) {
    log(`waiting ${Math.ceil(wait / 1000)}s: CONTRACT.md step 5, push no sooner than 60 s after the claim`);
    await sleep(wait);
  }
  const results = await Promise.all(
    file.candidates.map((c) => {
      const script = SCRIPTS.find((s) => s.agent === c.agent);
      if (script === undefined || !c.ok) throw new Error(`no script or failed slot for ${c.name}`);
      return runCandidate(c, script, file.session);
    }),
  );
  for (const r of results) log("candidate:", r);
}

// ---------------------------------------------------------------- admission

type Verdict = "ADMIT" | "REFUSE" | "SEND_BACK";
interface Check {
  readonly name: string;
  readonly result: "pass" | "fail" | "skipped";
  readonly detail: string;
}
const REQUIRED_NOTE_FIELDS = ["contract", "canonical", "objective", "base", "run_id", "prompt", "reason", "checks"] as const;

async function checkNote(dir: string, file: ClaimFile): Promise<{ check: Check; base: string | null }> {
  const raw = await $`git -C ${dir} notes show HEAD`.nothrow().quiet();
  if (raw.exitCode !== 0) return { check: { name: "note", result: "fail", detail: "no submitter note on the tip (refs/notes/commits)" }, base: null };
  let note: Record<string, unknown>;
  try {
    note = JSON.parse(raw.stdout.toString()) as Record<string, unknown>;
  } catch {
    return { check: { name: "note", result: "fail", detail: "the note is not JSON" }, base: null };
  }
  const missing = REQUIRED_NOTE_FIELDS.filter((f) => note[f] === undefined || note[f] === "");
  if (missing.length > 0) return { check: { name: "note", result: "fail", detail: `missing fields: ${missing.join(", ")}` }, base: null };
  if (note.contract !== CONTRACT_ID) return { check: { name: "note", result: "fail", detail: `contract is not ${CONTRACT_ID}` }, base: null };
  if (note.canonical !== file.claim.canonical || note.objective !== file.claim.objective) {
    return { check: { name: "note", result: "fail", detail: "canonical or objective does not match the claim" }, base: null };
  }
  const base = String(note.base);
  if (!/^[0-9a-f]{40}$/.test(base)) return { check: { name: "note", result: "fail", detail: "base is not a 40-character sha" }, base: null };
  const anc = await $`git -C ${dir} merge-base --is-ancestor ${base} HEAD`.nothrow().quiet();
  if (anc.exitCode !== 0) return { check: { name: "note", result: "fail", detail: "base is not an ancestor of the tip" }, base: null };
  return { check: { name: "note", result: "pass", detail: "all required fields present; matches the claim" }, base };
}

async function rule(c: ClaimCandidate, file: ClaimFile): Promise<{ verdict: Verdict; reason: string; checks: Check[]; tip: string; dir: string; token: string; remote: string }> {
  const token = await mintToken(c.name);
  const auth = authHeader(token);
  const dir = join(WORKDIR, "admission", c.name);
  await rm(dir, { recursive: true, force: true });
  await sh($`git -c ${auth} clone --quiet ${c.remote} ${dir}`, `clone ${c.name}`);
  await $`git -C ${dir} -c ${auth} fetch --quiet ${c.remote} refs/notes/commits:refs/notes/commits`.nothrow().quiet();
  await identity(dir, `${CANONICAL} admission authority`, `${CANONICAL}-authority@agent-collab.invalid`);
  const tip = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse tip");

  const { check: noteCheck, base: noteBase } = await checkNote(dir, file);
  const canonicalHead = (await repoInfo(file.claim.canonical)).head;
  const base = noteBase ?? canonicalHead;
  const changed = base === null ? [] : (await sh($`git -C ${dir} diff --name-only ${base} HEAD`, "diff")).split("\n").filter((p) => p !== "");
  const reserved = changed.filter((p) => (RESERVED[file.claim.canonical] ?? []).includes(p));
  const reservedCheck: Check = reserved.length === 0
    ? { name: "reserved-paths", result: "pass", detail: `${changed.length} path(s) changed: ${changed.join(", ")}` }
    : { name: "reserved-paths", result: "fail", detail: `touches reserved ${reserved.join(", ")}` };
  let testCheck: Check;
  if (changed.some((p) => EXEC_CONFIG.includes(p))) {
    testCheck = { name: "tests", result: "skipped", detail: "package.json or bunfig.toml changed" };
  } else {
    const t = await $`timeout 120 bun test`.cwd(dir).nothrow().quiet();
    const summary = `${t.stdout.toString()}${t.stderr.toString()}`.match(/(\d+) pass[\s\S]*?(\d+) fail/);
    testCheck = { name: "tests", result: t.exitCode === 0 ? "pass" : "fail", detail: summary ? `bun test: ${summary[1]} pass, ${summary[2]} fail` : `bun test exit ${t.exitCode}` };
  }
  const checks = [noteCheck, reservedCheck, testCheck];

  let verdict: Verdict = "ADMIT";
  let reason = "every check passes; the note cites the failing test it fixes";
  if (reservedCheck.result === "fail") {
    verdict = "REFUSE";
    reason = `${reservedCheck.detail}. Every other check passes, but CONTRACT.md reserves that path for the authority.`;
  } else if (noteCheck.result === "fail") {
    verdict = "SEND_BACK";
    reason = `submitter note: ${noteCheck.detail}`;
  } else if (testCheck.result !== "pass") {
    verdict = "SEND_BACK";
    reason = `${testCheck.detail}; 'feed timestamps are ISO-8601' is still red. Fix the feed-level updated timestamp too.`;
  }
  return { verdict, reason, checks, tip, dir, token, remote: c.remote };
}

async function writeAdmissionNote(dir: string, token: string, remote: string, note: Record<string, unknown>): Promise<void> {
  const path = join(dir, "..", `${note.candidate}.admission.json`);
  await Bun.write(path, JSON.stringify(note, null, 2));
  await sh($`git -C ${dir} notes --ref=admission add -f -F ${path} HEAD`, "notes add admission");
  await sh($`git -C ${dir} -c ${authHeader(token)} push --quiet ${remote} refs/notes/admission`, "push admission note");
}

// Merge the admitted tip into the canonical, copy the notes, tag the release. Returns the merge.
async function mergeWinner(name: string, candidateRemote: string, candidateToken: string, canonical: string): Promise<{ merge: string; tag: string; remote: string; token: string }> {
  const { remote } = await repoInfo(canonical);
  const token = await mintToken(canonical);
  const auth = authHeader(token);
  const dir = join(WORKDIR, "merge", canonical);
  await rm(dir, { recursive: true, force: true });
  await sh($`git -c ${auth} clone --quiet ${remote} ${dir}`, `clone ${canonical}`);
  await identity(dir, `${canonical} admission authority`, `${canonical}-authority@agent-collab.invalid`);
  const cauth = authHeader(candidateToken);
  await sh($`git -C ${dir} -c ${cauth} fetch --quiet ${candidateRemote} main:refs/candidates/tip refs/notes/commits:refs/notes/commits`, "fetch candidate");
  await sh($`git -C ${dir} checkout --quiet -b ${`admit/${name}`}`, "checkout admit branch");
  await sh($`git -C ${dir} merge --no-ff --quiet -m ${`Admit ${name}: ${OBJECTIVE}`} refs/candidates/tip`, "merge");
  const merge = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse merge");
  await sh($`git -C ${dir} tag -a ${RELEASE_TAG} -m ${`Release ${RELEASE_TAG}: admits ${name}`}`, "tag");
  await sh($`git -C ${dir} -c ${auth} push --quiet ${remote} HEAD:refs/heads/main`, "push main");
  await sh($`git -C ${dir} -c ${auth} push --quiet ${remote} refs/notes/commits`, "push notes");
  await sh($`git -C ${dir} -c ${auth} push --quiet ${remote} ${`refs/tags/${RELEASE_TAG}`}`, "push tag");
  return { merge, tag: RELEASE_TAG, remote, token };
}

async function admit(): Promise<void> {
  const file = await readClaim();
  const rulings = [];
  for (const c of file.candidates) rulings.push({ c, r: await rule(c, file) });
  let merged = false;
  for (const { c, r } of rulings) {
    const ruledAt = new Date().toISOString();
    let mergeCommit: string | null = null;
    let tag: string | null = null;
    let canonicalPush: { remote: string; token: string } | null = null;
    if (r.verdict === "ADMIT" && !merged) {
      const m = await mergeWinner(c.name, r.remote, r.token, file.claim.canonical);
      mergeCommit = m.merge;
      tag = m.tag;
      canonicalPush = { remote: m.remote, token: m.token };
      merged = true;
    }
    const note = {
      contract: CONTRACT_ID, candidate: c.name, verdict: r.verdict, reason: r.reason, checks: r.checks,
      commit: r.tip, ruled_at: ruledAt, merge_commit: mergeCommit, tag,
    };
    await writeAdmissionNote(r.dir, r.token, r.remote, note);
    // The admitted tip is now in the canonical's history, so its ruling travels with it.
    if (canonicalPush !== null) {
      await sh($`git -C ${r.dir} -c ${authHeader(canonicalPush.token)} push --quiet ${canonicalPush.remote} refs/notes/admission`, "push admission note to canonical");
    }
    const posted = await api("/api/arena/verdicts", {
      candidate: c.name, canonical: file.claim.canonical, objective: file.claim.objective, verdict: r.verdict,
      reason: r.reason, commit: r.tip, note_ref: "refs/notes/admission", merge_commit: mergeCommit ?? undefined, tag: tag ?? undefined,
    });
    log(`verdict ${c.name}:`, { verdict: r.verdict, reason: r.reason, checks: r.checks.map((k) => `${k.name}=${k.result}`), merge: mergeCommit, tag, recorded: posted.ok });
  }
}

// ---------------------------------------------------------------- verify

async function verify(): Promise<void> {
  const s = (await api("/api/state", undefined, null)) as {
    repos?: { name: string; role: string }[];
    arenaClaims?: unknown[];
    verdicts?: { candidate: string; verdict: string; merge_commit: string | null; tag: string | null }[];
    events?: { repo: string; ref: string | null; after: string | null; received_at: string }[];
  };
  log("repos:", (s.repos ?? []).map((r) => `${r.role}:${r.name}`));
  log("claims:", s.arenaClaims ?? []);
  log("verdicts:", s.verdicts ?? []);
  const byRef = new Map<string, number>();
  for (const e of s.events ?? []) byRef.set(`${e.repo} ${e.ref}`, (byRef.get(`${e.repo} ${e.ref}`) ?? 0) + 1);
  log("push events by repo and ref:", Object.fromEntries(byRef));
  for (const name of Object.keys(SEEDS)) {
    const r = (await api(`/api/repos/${name}`)) as { log?: { hash: string; message: string }[] };
    log(`log ${name}:`, (r.log ?? []).map((l) => `${l.hash.slice(0, 10)} ${l.message.split("\n")[0]}`));
  }
  const { remote } = await repoInfo(CANONICAL);
  const refs = await sh($`git -c ${authHeader(await mintToken(CANONICAL))} ls-remote ${remote}`, "ls-remote canonical");
  log(`refs ${CANONICAL}:`, refs.split("\n").map((l) => l.replace(/^([0-9a-f]{10})[0-9a-f]+\s+/, "$1 ")));
  if (!(await Bun.file(CLAIM_FILE).exists())) return;
  // CONTRACT.md step 10, as the submitter: the claim's own token reads the admission note.
  const file = await readClaim();
  for (const c of file.candidates) {
    const dir = join(WORKDIR, "candidates", c.name);
    const auth = authHeader(c.token);
    const fetched = await $`git -C ${dir} -c ${auth} fetch --quiet ${c.remote} +refs/notes/admission:refs/notes/admission`.nothrow().quiet();
    const shown = await $`git -C ${dir} notes --ref=admission show HEAD`.nothrow().quiet();
    const note = shown.exitCode === 0 ? (JSON.parse(shown.stdout.toString()) as { verdict?: string; reason?: string }) : null;
    log(`submitter view ${c.name}:`, { fetch: fetched.exitCode, verdict: note?.verdict ?? null, reason: note?.reason ?? null });
  }
}

// The authority publishes a CONTRACT.md revision to the spec canonical. CONTRACT.md is reserved,
// so this is the only way it changes.
async function publishContract(): Promise<void> {
  const { remote } = await repoInfo("spec");
  const auth = authHeader(await mintToken("spec"));
  const dir = join(WORKDIR, "publish", "spec");
  await rm(dir, { recursive: true, force: true });
  await sh($`git -c ${auth} clone --quiet ${remote} ${dir}`, "clone spec");
  await identity(dir, "spec admission authority", "spec-authority@agent-collab.invalid");
  await sh($`git -C ${dir} checkout --quiet -b contract`, "checkout");
  await cp(join(ROOT, "CONTRACT.md"), join(dir, "CONTRACT.md"));
  if ((await sh($`git -C ${dir} status --porcelain`, "status")) === "") {
    log("publish-contract: no change");
    return;
  }
  await sh($`git -C ${dir} commit --quiet -am ${"CONTRACT.md v0.1: show how to build the submitter note"}`, "commit");
  await sh($`git -C ${dir} -c ${auth} push --quiet ${remote} HEAD:refs/heads/main`, "push spec");
  log("publish-contract: pushed", await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse"));
}

const commands: Record<string, () => Promise<void>> = {
  canonicals, claim, candidates, admit, verify, "publish-contract": publishContract,
};
const cmd = process.argv[2] ?? "";
const run = commands[cmd];
if (run === undefined) throw new Error(`unknown command "${cmd}"; one of ${Object.keys(commands).join(", ")}`);
await mkdir(WORKDIR, { recursive: true });
await run();
