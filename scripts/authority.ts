// The observatory's admission authority (CONTRACT.md v0.2). Subcommands:
//   publish <spec|api|site>   push this repository's seed for a canonical, never reverting an ask
//                             file a candidate already delivered
//   pull-spec                 copy the spec canonical's SPEC.md and CONTRACT.md, with admitted
//                             amendments, back into this repository
//   admit <candidate>         rule on one candidate's live tip; on spec, an amendment (ISSUE-00015)
//   admit <candidate> --dry   on spec only: run every amendment check, log the ruling, post nothing
//   watch                     rule on every candidate whose live tip has no ruling, forever, write
//                             Decision Records for the control Worker (ISSUE-00021), and carry out
//                             what a human decides on a red one
//
// Candidate code runs only inside bwrap: no network, no home directory, a read-only system, and
// the clone as its only writable path. Tokens and keys are never printed.
//
//   sh scripts/cf-env.sh bun --env-file=<private env file> scripts/authority.ts <subcommand>

import { $ } from "bun";
import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hasHidden, prepareHidden } from "./hidden";
import { admissionErrorRecord, admitRecord, amendmentRecord, escalatedRecord, reservedPathRecord, routedRecord, sendBackRecord } from "./records";
import { classify, inferenceTool, type Classification, type Proposal } from "./gyr";
import { judgeScope } from "./scope";
import { AMEND_PREFIX, AMENDABLE, judgeAdditions, judgeAmendScope, replayKind, resolveCite } from "./amend";
import type { CitableVerdict } from "./amend";
import type { DecisionClass, DecisionKind, DecisionRecord } from "../src/decisions";
import { REVIEW_POLICY_V0, contributorOf, deriveStanding, orderReviewQueue, outcomeFromRuling, type PendingCandidate, type Standing } from "../src/reputation";

const ROOT = join(import.meta.dir, "..");
const WORKDIR = join(ROOT, ".workdirs", "authority");
const CONTRACT_ID = "agent-collab/0.2";
const SPEC = "spec";
// Who admits a spec amendment that passes every check: the owner through a red decision (default),
// or the authority alone with AMEND_GATE=auto (ISSUE-00015).
const AMEND_GATE: "human" | "auto" = process.env.AMEND_GATE === "auto" ? "auto" : "human";
const BUN = await realBun();
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");

// The one file a candidate may change, per canonical (CONTRACT.md "What a candidate may change").
const ASK_FILE: Record<string, (objective: string) => string> = {
  api: (o) => `src/series/${o}.ts`,
  site: (o) => `views/${o}.js`,
};
const ASK_PREFIX: Record<string, string> = { api: "series-", site: "view-" };
const CANDIDATE_OWNED = /^(src\/series\/[a-z0-9-]+\.ts|views\/[a-z0-9-]+\.js)$/;

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
async function realBun(): Promise<string> {
  return (await $`readlink -f ${process.execPath}`.text()).trim();
}
function redact(s: string): string {
  return s.replaceAll(accountId, "<ACCT>").replace(/art_v\d+_[0-9A-Za-z_]+(\?expires=\d+)?/g, "art_<redacted>");
}
// Text that goes onto the board, where a human reads it: no account id, token, control URL or
// checkout path.
function boardText(s: string): string {
  return redact(s).replaceAll(baseUrl, "<control>").replaceAll(ROOT, "<root>");
}
function log(label: string, value?: unknown): void {
  const text = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  console.log(redact(`${new Date().toISOString()} ${label} ${text}`.trim()));
}

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${adminKey}`, "content-type": "application/json" },
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
async function repoInfo(repo: string): Promise<{ remote: string; head: string | null; hashes: string[] }> {
  const r = (await api(`/api/repos/${repo}`)) as { ok?: boolean; info?: { remote?: string }; log?: { hash: string }[] };
  if (r.ok !== true || typeof r.info?.remote !== "string") throw new Error(redact(`repo info failed for ${repo}: ${JSON.stringify(r)}`));
  return { remote: r.info.remote, head: r.log?.[0]?.hash ?? null, hashes: (r.log ?? []).map((l) => l.hash) };
}
const auth = (token: string): string => `http.extraHeader=Authorization: Bearer ${token}`;

async function sh(cmd: ReturnType<typeof $>, what: string): Promise<string> {
  const r = await cmd.nothrow().quiet();
  if (r.exitCode !== 0) throw new Error(redact(`${what} failed (exit ${r.exitCode}): ${r.stderr.toString().trim()}`));
  return r.stdout.toString().trim();
}
async function identity(dir: string, canonical: string): Promise<void> {
  await sh($`git -C ${dir} config user.name ${`${canonical} admission authority`}`, "config name");
  await sh($`git -C ${dir} config user.email ${`${canonical}-authority@agent-collab.invalid`}`, "config email");
}
async function clone(repo: string, token: string, dir: string): Promise<string> {
  const { remote } = await repoInfo(repo);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  await sh($`git -c ${auth(token)} clone --quiet ${remote} ${dir}`, `clone ${repo}`);
  return remote;
}

// ---------------------------------------------------------------- publish

async function seedFiles(canonical: string): Promise<Record<string, string>> {
  if (canonical === "spec") {
    return { "SPEC.md": "canonicals/spec/SPEC.md", "CONTRACT.md": "CONTRACT.md", "BOOTSTRAP.md": "canonicals/spec/BOOTSTRAP.md", "RUNS.md": "canonicals/spec/RUNS.md", "START.md": "canonicals/spec/START.md" };
  }
  const out: Record<string, string> = {};
  for await (const f of new Bun.Glob("**/*").scan({ cwd: join(ROOT, "canonicals", canonical) })) out[f] = `canonicals/${canonical}/${f}`;
  return out;
}

async function publish(canonical: string, message: string): Promise<void> {
  const token = await mintToken(canonical);
  const dir = join(WORKDIR, "publish", canonical);
  const remote = await clone(canonical, token, dir);
  await identity(dir, canonical);
  await sh($`git -C ${dir} checkout --quiet -b publish`, "checkout");
  // An admitted amendment is spec's history (ISSUE-00015): refuse to publish a seed that lacks it.
  if (canonical === SPEC) await refuseLostAmendments(dir);
  const kept: string[] = [];
  for (const [dest, src] of Object.entries(await seedFiles(canonical))) {
    // An ask file a candidate delivered is product, not seed. Publish never overwrites one.
    if (CANDIDATE_OWNED.test(dest) && (await Bun.file(join(dir, dest)).exists())) {
      kept.push(dest);
      continue;
    }
    await mkdir(dirname(join(dir, dest)), { recursive: true });
    await cp(join(ROOT, src), join(dir, dest));
  }
  await sh($`git -C ${dir} add -A`, "add");
  if ((await sh($`git -C ${dir} status --porcelain`, "status")) === "") {
    log(`publish ${canonical}: no change`, { kept: kept.length });
    return;
  }
  await sh($`git -C ${dir} commit --quiet -m ${message}`, "commit");
  await sh($`git -C ${dir} -c ${auth(token)} push --quiet ${remote} HEAD:refs/heads/main`, "push");
  log(`publish ${canonical}: pushed`, { head: await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse"), keptAskFiles: kept.length });
}

// The seed's SPEC.md and CONTRACT.md must carry every line the spec canonical carries; an admitted
// amendment adds lines there first. `pull-spec` copies them back into this repository.
async function refuseLostAmendments(dir: string): Promise<void> {
  // Only lines an admitted amendment's merge added are checked, so a hand edit that rewrites
  // other lines still publishes. An empty canonical (a first install) has no history to lose.
  if ((await $`git -C ${dir} rev-parse --verify --quiet HEAD`.nothrow().quiet()).exitCode !== 0) return;
  const seed = await seedFiles(SPEC);
  const merges = (await sh($`git -C ${dir} log --format=%H --grep ${`^Admit cand--${AMEND_PREFIX}`}`, "amendment merges")).split("\n").filter(Boolean);
  for (const m of merges) {
    for (const file of AMENDABLE) {
      const added = (await sh($`git -C ${dir} diff -U0 ${`${m}^1`} ${m} -- ${file}`, "amendment diff")).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
      const local = new Set((await Bun.file(join(ROOT, seed[file] ?? file)).text()).split("\n"));
      const lost = added.filter((l) => l.trim() !== "" && !local.has(l));
      if (lost.length > 0) throw new Error(`the seed's ${file} lacks ${lost.length} line(s) admitted amendment ${m.slice(0, 10)} added; run authority.ts pull-spec, commit, then publish`);
    }
  }
}

async function pullSpec(): Promise<void> {
  const token = await mintToken(SPEC);
  const dir = join(WORKDIR, "pull", SPEC);
  await clone(SPEC, token, dir);
  const seed = await seedFiles(SPEC);
  for (const file of AMENDABLE) await cp(join(dir, file), join(ROOT, seed[file] ?? file));
  log("pull-spec: copied", { files: AMENDABLE, head: await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse") });
}

// ---------------------------------------------------------------- admission

type Verdict = "ADMIT" | "REFUSE" | "SEND_BACK";
interface Check {
  readonly name: string;
  readonly result: "pass" | "fail" | "skipped";
  readonly detail: string;
}
interface ArenaState {
  repos: { name: string; role: string; parent: string | null }[];
  events: { id: number; repo: string; ref: string | null; after: string | null; received_at: string }[];
  verdicts: { candidate: string; canonical: string; objective: string; verdict: string; commit: string; reason?: string; ruled_at: string }[];
}
const REQUIRED_NOTE_FIELDS = ["contract", "canonical", "objective", "base", "run_id", "prompt", "reason", "checks"] as const;

async function arenaState(): Promise<ArenaState> {
  return (await (await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${adminKey}` } })).json()) as ArenaState;
}

function sandboxed(dir: string, sub: "test" | "run", file: string): ReturnType<typeof $> {
  return $`bwrap --ro-bind /usr /usr --ro-bind /etc /etc --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin --proc /proc --dev /dev --tmpfs /tmp --ro-bind ${BUN} /opt/bun --bind ${dir} /work --chdir /work --unshare-all --die-with-parent --clearenv --setenv HOME /tmp --setenv PATH /usr/bin:/bin /usr/bin/timeout 120 /opt/bun ${sub} ${`./${file}`}`;
}

async function sandboxTest(dir: string, file: string): Promise<{ ok: boolean; detail: string }> {
  const r = await sandboxed(dir, "test", file).nothrow().quiet();
  const out = `${r.stdout.toString()}${r.stderr.toString()}`;
  const pass = out.match(/(\d+) pass/)?.[1] ?? "0";
  const fail = out.match(/(\d+) fail/)?.[1] ?? "?";
  return { ok: r.exitCode === 0, detail: `${file}: ${pass} pass, ${fail} fail (exit ${r.exitCode})` };
}

// The hidden check (scripts/hidden.ts): fresh inputs, expected outputs computed here from the
// private reference, only the candidate's file run in the sandbox. Its files are removed after.
async function hiddenCheck(dir: string, canonical: string, objective: string): Promise<Check> {
  // An ask with no reference is the authority's gap, never the candidate's: post no ruling.
  if (!(await hasHidden(canonical, objective))) throw new Error(`no hidden check for ${canonical}/${objective}; add canonicals/reference/${canonical}/${objective}`);
  const run = await prepareHidden(canonical, objective, WORKDIR);
  try {
    for (const [path, text] of Object.entries(run.files)) await Bun.write(join(dir, path), text);
    const r = await sandboxed(dir, "run", run.driver).nothrow().quiet();
    const out = Bun.file(join(dir, run.output));
    const raw: unknown = r.exitCode === 0 && (await out.exists()) ? await out.json().catch(() => null) : null;
    const { cases, failed } = run.judge(raw);
    if (cases === 0) throw new Error(`hidden check for ${objective} produced no cases`);
    return failed.length === 0
      ? { name: "hidden", result: "pass", detail: `${cases} hidden cases match` }
      : { name: "hidden", result: "fail", detail: `${failed.length} of ${cases} hidden cases differ from what SPEC.md asks (exit ${r.exitCode}); derive the answer from the input, never from the public fixture` };
  } finally {
    for (const path of [...Object.keys(run.files), run.output]) await rm(join(dir, path), { force: true });
  }
}

async function readNote(dir: string): Promise<{ note: Record<string, unknown> | null; problem: string | null }> {
  const raw = await $`git -C ${dir} notes show HEAD`.nothrow().quiet();
  if (raw.exitCode !== 0) return { note: null, problem: "no submitter note on the tip (refs/notes/commits)" };
  try {
    return { note: JSON.parse(raw.stdout.toString()) as Record<string, unknown>, problem: null };
  } catch {
    return { note: null, problem: "the note is not JSON" };
  }
}

async function nextTag(dir: string): Promise<string> {
  // Interpolated, so Bun's shell passes the pattern to git instead of globbing it.
  const tags = (await sh($`git -C ${dir} tag -l ${"v*"}`, "tags")).split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  const minors = tags.map((t) => Number(t.split(".")[1]));
  return `v0.${(minors.length ? Math.max(...minors) : 0) + 1}.0`;
}

// ---------------------------------------------------------------- decisions (ISSUE-00021)

interface DecisionView {
  id: number;
  class: string;
  kind: string;
  status: string;
  subject: string;
  action: string | null;
  choice: string | null;
  acted_at: string | null;
  record: { evidence: { summary: string; refs?: string[] }; why_now: { summary: string }; recommendation: { choice: string } };
}
// A waiver whose run failed, by the key of the admission_error record that offers a retry. Memory
// only: after a restart the human re-runs `authority.ts admit`.
const waiverRetry = new Map<string, { subject: string; paths: string[] }>();
const KEY_PREFIX = "ruling key: ";

async function postDecision(cls: DecisionClass, kind: DecisionKind, subject: string, record: DecisionRecord): Promise<void> {
  const r = await api("/api/arena/decisions", { class: cls, kind, subject, record });
  if (r.ok !== true) throw new Error(boardText(`decision record refused: ${JSON.stringify(r).slice(0, 300)}`));
}
async function decisionRows(): Promise<DecisionView[]> {
  const r = await api("/api/arena/decisions");
  return Array.isArray(r.decisions) ? (r.decisions as DecisionView[]) : [];
}
const keyOf = (d: DecisionView): string | undefined => d.record.evidence.refs?.find((x) => x.startsWith(KEY_PREFIX))?.slice(KEY_PREFIX.length);

// ISSUE-00029: every proposed red passes the GYR gate (scripts/gyr.ts). Red opens for the human
// with the classifier's verdict in its evidence. Green or yellow posts a routed row and returns the
// classification, and the caller carries out its choice with agent authority. GYR_GATE=off in the
// watch's environment restores the red-by-default gate, and so does a host with no inference tool.
const GYR_GATE: "on" | "off" = process.env.GYR_GATE === "off" || inferenceTool() === null ? "off" : "on";
async function proposeRed(p: Proposal): Promise<Classification> {
  const c: Classification = GYR_GATE === "off"
    ? { cls: "red", reason: "the GYR gate is off", criteria: p.record.why_now.red_criteria ?? [], choice: "", by: "rule" }
    : await classify(p);
  log(`gyr ${p.subject}:`, { kind: p.kind, class: c.cls, by: c.by, choice: c.choice, reason: c.reason });
  if (c.cls === "red") await postDecision("red", p.kind, p.subject, escalatedRecord(p.record, c));
  else await postDecision(c.cls, c.cls === "green" ? "routed_green" : "routed_yellow", p.subject, routedRecord(p.record, p.kind, c));
  return c;
}
const contractText = async (): Promise<string> => Bun.file(join(ROOT, "CONTRACT.md")).text();

// A failed ruling key the authority retried once on a routed decision. A second failure on it is
// red without a model call. Memory only, like waiverRetry.
const retried = new Set<string>();

// One record per failed key, never a second red while one is open. A routed retry clears the key so
// the watch rules again; a routed send-back posts the error as the reason. Best effort: a record
// that does not post is logged, and the candidate stays parked as before.
async function postErrorRecord(candidate: string, key: string, error: string, failed?: Set<string>): Promise<void> {
  try {
    if ((await decisionRows()).some((d) => d.kind === "admission_error" && d.status === "open" && keyOf(d) === key)) return;
    const record = admissionErrorRecord({ candidate, key, error: boardText(error).slice(0, 500) });
    const c = await proposeRed({ kind: "admission_error", subject: candidate, record, contract: await contractText(), repeat: retried.has(key) });
    if (c.cls === "red") return;
    if (c.choice === "retry") {
      retried.add(key);
      failed?.delete(key);
      const waiver = waiverRetry.get(key);
      if (waiver !== undefined) {
        waiverRetry.delete(key);
        await admitCandidate(waiver.subject, await arenaState(), new Map([[waiver.subject, waiver.paths]]));
      }
    } else if (c.choice === "send_back") await sendBackWith(candidate, record.evidence.summary);
  } catch (err) {
    log(`decision record for ${candidate} not posted:`, String(err).slice(0, 200));
  }
}

// ADMIT is green, SEND_BACK is yellow, and a REFUSE on scope with paths a waiver could cover is red.
// Best effort: the ruling stands whether or not its record posts.
async function recordRuling(
  name: string, verdict: Verdict, reason: string, tag: string | null,
  scope: { askFile: string; outside: readonly string[]; decisive: boolean },
): Promise<void> {
  try {
    if (verdict === "ADMIT") await postDecision("green", "admit", name, admitRecord({ candidate: name, tag }));
    else if (verdict === "SEND_BACK") await postDecision("yellow", "send_back", name, sendBackRecord({ candidate: name, reason: boardText(reason) }));
    else if (scope.decisive) {
      const record = reservedPathRecord({ candidate: name, askFile: scope.askFile, paths: scope.outside, reason: boardText(reason) });
      const c = await proposeRed({ kind: "reserved_path", subject: name, record, contract: await contractText() });
      log(`decision for ${name}:`, { kind: "reserved_path", class: c.cls, choice: c.choice, paths: scope.outside });
      // A routed waive runs the checks again with the paths waived; a routed refuse lets the REFUSE stand.
      if (c.cls !== "red" && c.choice === "waive") await admitCandidate(name, await arenaState(), new Map([[name, [...scope.outside]]]));
    }
  } catch (err) {
    log(`decision record for ${name} not posted:`, String(err).slice(0, 200));
  }
}

// Carries out what a human decided on each red row not yet acted on, then marks it acted. Approve
// or choose_alternative waive admits with a scope waiver; approve or choose_alternative retry
// clears the failed key so the watch rules again; choose_alternative send_back posts SEND_BACK
// with the error as the reason. Every other action changes nothing.
async function actOnDecisions(failed: Set<string>): Promise<void> {
  for (const d of await decisionRows()) {
    if (d.class !== "red" || d.status !== "decided" || d.acted_at !== null) continue;
    try {
      await carryOut(d, failed);
    } catch (err) {
      log(`decision ${d.id} failed to carry out:`, String(err).slice(0, 300));
      await postErrorRecord(d.subject, `decision ${d.id}`, String(err), failed);
    }
    const done = await api(`/api/arena/decisions/${d.id}/acted`, {});
    log(`decision ${d.id} acted:`, { kind: d.kind, action: d.action, choice: d.choice, recorded: done.ok });
  }
}

async function carryOut(d: DecisionView, failed: Set<string>): Promise<void> {
  const approve = d.action === "approve";
  const chose = d.action === "choose_alternative" ? d.choice : null;
  if (d.kind === "reserved_path" && (approve || chose === "waive")) {
    const paths = d.record.evidence.refs ?? [];
    try {
      await admitCandidate(d.subject, await arenaState(), new Map([[d.subject, paths]]));
    } catch (err) {
      waiverRetry.set(`decision ${d.id}`, { subject: d.subject, paths });
      throw err;
    }
  } else if (d.kind === "admission_error" && (approve || chose === "retry")) {
    const key = keyOf(d);
    if (key === undefined) return;
    failed.delete(key);
    const waiver = waiverRetry.get(key);
    if (waiver !== undefined) {
      waiverRetry.delete(key);
      await admitCandidate(waiver.subject, await arenaState(), new Map([[waiver.subject, waiver.paths]]));
    }
  } else if (d.kind === "amendment" && (approve || chose === "admit" || d.action === "reject" || chose === "refuse")) {
    const tip = keyOf(d)?.split(" ")[1];
    await admitAmendment(d.subject, d.subject.split("--")[1] ?? "", await arenaState(), { owner: approve || chose === "admit" ? "admit" : "refuse", tip, decision: d.id });
  } else if (d.kind === "admission_error" && chose === "send_back") {
    await sendBackWith(d.subject, d.record.evidence.summary);
  }
}

async function sendBackWith(subject: string, errorSummary: string): Promise<void> {
  const state = await arenaState();
  const canonical = state.repos.find((r) => r.name === subject)?.parent;
  const { head } = await repoInfo(subject);
  if (canonical === undefined || canonical === null || head === null) throw new Error(`cannot send back ${subject}: no canonical or no head`);
  const reason = `authority error: ${errorSummary}`.slice(0, 500);
  const posted = await api("/api/arena/verdicts", {
    candidate: subject, canonical, objective: subject.split("--")[1] ?? "", verdict: "SEND_BACK", reason, commit: head,
  });
  if (posted.ok !== true) throw new Error(boardText(`send back refused: ${JSON.stringify(posted).slice(0, 300)}`));
  await recordRuling(subject, "SEND_BACK", reason, null, { askFile: "", outside: [], decisive: false });
}

// A waiver names paths a candidate may change besides its ask file, for this ruling only.
type Waivers = ReadonlyMap<string, readonly string[]>;

async function admitCandidate(name: string, state: ArenaState, waivers: Waivers = new Map()): Promise<void> {
  const parts = name.split("--");
  const objective = parts[1] ?? "";
  const canonical = state.repos.find((r) => r.name === name)?.parent ?? "";
  if (canonical === SPEC) return admitAmendment(name, objective, state);
  const token = await mintToken(name);
  const dir = join(WORKDIR, "admission", name);
  const remote = await clone(name, token, dir);
  await $`git -C ${dir} -c ${auth(token)} fetch --quiet ${remote} refs/notes/commits:refs/notes/commits`.nothrow().quiet();
  await identity(dir, canonical);
  const tip = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse");

  const checks: Check[] = [];
  const askFile = ASK_FILE[canonical]?.(objective);
  const isAsk = askFile !== undefined && objective.startsWith(ASK_PREFIX[canonical] ?? "\u0000");

  // note: needed first, because its base anchors the scope diff.
  const { note, problem } = await readNote(dir);
  let base: string | null = null;
  let noteCheck: Check;
  if (note === null) {
    noteCheck = { name: "note", result: "fail", detail: problem ?? "no note" };
  } else {
    const missing = REQUIRED_NOTE_FIELDS.filter((f) => note[f] === undefined || note[f] === "");
    const b = String(note.base ?? "");
    const anc = /^[0-9a-f]{40}$/.test(b) ? (await $`git -C ${dir} merge-base --is-ancestor ${b} HEAD`.nothrow().quiet()).exitCode === 0 : false;
    if (missing.length > 0) noteCheck = { name: "note", result: "fail", detail: `missing fields: ${missing.join(", ")}` };
    else if (note.contract !== CONTRACT_ID) noteCheck = { name: "note", result: "fail", detail: `contract must be ${CONTRACT_ID}` };
    else if (note.canonical !== canonical || note.objective !== objective) noteCheck = { name: "note", result: "fail", detail: `canonical and objective must be ${canonical} and ${objective}` };
    else if (!anc) noteCheck = { name: "note", result: "fail", detail: "base is not a 40-character ancestor of the tip" };
    else {
      noteCheck = { name: "note", result: "pass", detail: "required fields present; matches the claim" };
      base = b;
    }
  }

  // objective: an open ask on this canonical, whose file exists at the base.
  const fileAtBase = base !== null && askFile !== undefined && (await $`git -C ${dir} cat-file -e ${`${base}:${askFile}`}`.nothrow().quiet()).exitCode === 0;
  const objectiveCheck: Check = !isAsk
    ? { name: "objective", result: "fail", detail: `${objective} is not an ask on ${canonical}` }
    : base === null
      ? { name: "objective", result: "skipped", detail: "needs a valid note base" }
      : fileAtBase
        ? { name: "objective", result: "pass", detail: `${askFile} is an ask file on ${canonical}` }
        : { name: "objective", result: "fail", detail: `${askFile} does not exist on ${canonical}` };

  // scope: exactly the ask's file changed, plus any path a human waived (a red record's approval).
  let scopeCheck: Check = { name: "scope", result: "skipped", detail: "needs a valid note base" };
  let outside: string[] = [];
  if (base !== null) {
    const changed = (await sh($`git -C ${dir} diff --name-only ${base} HEAD`, "diff")).split("\n").filter(Boolean);
    const waived = waivers.get(name) ?? [];
    const judged = judgeScope(changed, askFile, waived);
    outside = judged.outside;
    scopeCheck = { name: "scope", result: judged.result, detail: judged.detail };
  }

  // first: one ADMIT per objective.
  const winner = state.verdicts.find((v) => v.canonical === canonical && v.objective === objective && v.verdict === "ADMIT");
  const firstCheck: Check = winner
    ? { name: "first", result: "fail", detail: `${objective} was already admitted from ${winner.candidate}` }
    : { name: "first", result: "pass", detail: "no earlier ADMIT on this objective" };

  // check: only when nothing above refuses, so refused code never runs.
  const refused = [objectiveCheck, scopeCheck, firstCheck].some((c) => c.result === "fail");
  let testCheck: Check = { name: "check", result: "skipped", detail: refused ? "refused before running" : "needs a valid note" };
  if (!refused && noteCheck.result === "pass" && scopeCheck.result === "pass") {
    const t = await sandboxTest(dir, `checks/${objective}.test.ts`);
    testCheck = { name: "check", result: t.ok ? "pass" : "fail", detail: t.detail };
  }
  // hidden: only after the public check passes, so its inputs are spent on plausible code.
  const hidden: Check = testCheck.result === "pass"
    ? await hiddenCheck(dir, canonical, objective)
    : { name: "hidden", result: "skipped", detail: "runs after the public check passes" };
  checks.push(objectiveCheck, scopeCheck, noteCheck, testCheck, hidden, firstCheck);

  let verdict: Verdict = "ADMIT";
  let reason = `every check passes; ${objective} is built`;
  const refusal = [objectiveCheck, scopeCheck, firstCheck].find((c) => c.result === "fail");
  if (refusal) {
    verdict = "REFUSE";
    reason = `${refusal.name}: ${refusal.detail}`;
  } else if (noteCheck.result !== "pass") {
    verdict = "SEND_BACK";
    reason = `note: ${noteCheck.detail}`;
  } else if (testCheck.result !== "pass") {
    verdict = "SEND_BACK";
    reason = `check: ${testCheck.detail}. Run bun test ./checks/${objective}.test.ts until it passes.`;
  } else if (hidden.result !== "pass") {
    verdict = "SEND_BACK";
    reason = `hidden: ${hidden.detail}.`;
  }

  let merge: string | null = null;
  let tag: string | null = null;
  const ruledAt = new Date().toISOString();
  if (verdict === "ADMIT") {
    try {
      ({ merge, tag } = await mergeAndRelease(name, remote, token, canonical, objective, tip, { verdict, reason, checks, ruledAt }));
    } catch (err) {
      // Only a conflict is the candidate's to fix. Any other failure is the authority's: post no
      // ruling, so the candidate is not blamed, and surface the error.
      if (!(err instanceof MergeConflict)) throw err;
      verdict = "SEND_BACK";
      reason = `merge into ${canonical} conflicts; fetch ${canonical} main, merge it, and push again (${err.message.slice(0, 160)})`;
    }
  }

  // A resubmission's fork already carries earlier rulings; postRuling keeps them under the new one.
  await postRuling({ name, dir, remote, token, canonical, objective, tip, verdict, reason, checks, ruledAt, merge, tag });
  if ((waivers.get(name)?.length ?? 0) > 0) await correctWaivedRefusal(name, canonical, tip, state);
  // A REFUSE on scope is the human's to waive only when nothing else refuses the candidate.
  const decisive = refusal?.name === "scope" && outside.length > 0 && firstCheck.result === "pass";
  await recordRuling(name, verdict, reason, tag, { askFile: askFile ?? "", outside, decisive });
}

// ---------------------------------------------------------------- amendments (ISSUE-00015)

// A candidate on the spec canonical proposes an amendment (CONTRACT.md "Amending the spec"). REFUSE
// on objective, scope, additions or first; SEND_BACK on the note or its cite; REFUSE when a cited
// SEND_BACK no longer reproduces, because then the amendment cites no measured failure. ADMIT merges
// into spec and tags it, like an ask.
interface AmendOpts { readonly dry?: boolean; readonly owner?: "admit" | "refuse"; readonly tip?: string; readonly decision?: number }
async function admitAmendment(name: string, objective: string, state: ArenaState, opts: AmendOpts = {}): Promise<void> {
  const dry = opts.dry === true;
  // A red record for this tip already exists: open, it waits for the owner; decided, actOnDecisions
  // carries it out. Either way the watch does not rule it again. A routed record for this tip means
  // the gate already ruled it: carry out that choice again rather than classify twice.
  let routed: { cls: string; choice: string; reason: string } | null = null;
  if (!dry && opts.owner === undefined) {
    const head = (await repoInfo(name)).head;
    const prior = (await decisionRows()).find((d) => (d.kind === "amendment" || d.kind.startsWith("routed_")) && keyOf(d) === `${name} ${head}`);
    if (prior?.kind === "amendment") return;
    if (prior !== undefined) routed = { cls: prior.class, choice: prior.record.recommendation.choice, reason: prior.record.why_now.summary };
  }
  const token = await mintToken(name);
  const dir = join(WORKDIR, "admission", name);
  const remote = await clone(name, token, dir);
  await $`git -C ${dir} -c ${auth(token)} fetch --quiet ${remote} refs/notes/commits:refs/notes/commits`.nothrow().quiet();
  await identity(dir, SPEC);
  const tip = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse");

  const objectiveCheck: Check = objective.startsWith(AMEND_PREFIX) && objective.length > AMEND_PREFIX.length
    ? { name: "objective", result: "pass", detail: `${objective} is an amendment on spec` }
    : { name: "objective", result: "fail", detail: `an objective on spec must start with ${AMEND_PREFIX}` };

  const { note, problem } = await readNote(dir);
  let base: string | null = null;
  let noteCheck: Check;
  let cited: CitableVerdict | null = null;
  if (note === null) noteCheck = { name: "note", result: "fail", detail: problem ?? "no note" };
  else {
    const missing = [...REQUIRED_NOTE_FIELDS, "cites"].filter((f) => note[f] === undefined || note[f] === "");
    const b = String(note.base ?? "");
    const anc = /^[0-9a-f]{40}$/.test(b) ? (await $`git -C ${dir} merge-base --is-ancestor ${b} HEAD`.nothrow().quiet()).exitCode === 0 : false;
    const cite = resolveCite(note.cites, state.verdicts);
    if (missing.length > 0) noteCheck = { name: "note", result: "fail", detail: `missing fields: ${missing.join(", ")}` };
    else if (note.contract !== CONTRACT_ID) noteCheck = { name: "note", result: "fail", detail: `contract must be ${CONTRACT_ID}` };
    else if (note.canonical !== SPEC || note.objective !== objective) noteCheck = { name: "note", result: "fail", detail: `canonical and objective must be ${SPEC} and ${objective}` };
    else if (!anc) noteCheck = { name: "note", result: "fail", detail: "base is not a 40-character ancestor of the tip" };
    else if (cite.verdict === null) noteCheck = { name: "note", result: "fail", detail: `cites: ${cite.problem}` };
    else {
      noteCheck = { name: "note", result: "pass", detail: `cites ${cite.verdict.verdict} on ${cite.verdict.objective} at ${cite.verdict.ruled_at}` };
      base = b;
      cited = cite.verdict;
    }
  }

  let scopeCheck: Check = { name: "scope", result: "skipped", detail: "needs a valid note base" };
  let additionsCheck: Check = { name: "additions", result: "skipped", detail: "needs a valid note base" };
  if (base !== null) {
    const changed = (await sh($`git -C ${dir} diff --name-only ${base} HEAD`, "diff")).split("\n").filter(Boolean);
    const s = judgeAmendScope(changed);
    scopeCheck = { name: "scope", result: s.result, detail: s.detail };
    additionsCheck = { name: "additions", ...judgeAdditions(await sh($`git -C ${dir} diff -U0 ${base} HEAD -- SPEC.md CONTRACT.md`, "diff additions")) };
  }

  const winner = state.verdicts.find((v) => v.canonical === SPEC && v.objective === objective && v.verdict === "ADMIT");
  const firstCheck: Check = winner
    ? { name: "first", result: "fail", detail: `${objective} was already admitted from ${winner.candidate}` }
    : { name: "first", result: "pass", detail: "no earlier ADMIT on this objective" };

  // replay: only when nothing above refuses or sends back.
  const blocked = [objectiveCheck, scopeCheck, additionsCheck, firstCheck, noteCheck].some((c) => c.result !== "pass");
  const replay: Check = blocked || cited === null
    ? { name: "replay", result: "skipped", detail: "runs after every other check passes" }
    : await replayCited(cited, state);
  const checks = [objectiveCheck, scopeCheck, additionsCheck, noteCheck, replay, firstCheck];

  let verdict: Verdict = "ADMIT";
  let reason = `every check passes; ${objective} amends the spec`;
  const refusal = [objectiveCheck, scopeCheck, additionsCheck, firstCheck].find((c) => c.result === "fail");
  if (refusal) { verdict = "REFUSE"; reason = `${refusal.name}: ${refusal.detail}`; }
  else if (noteCheck.result !== "pass") { verdict = "SEND_BACK"; reason = `note: ${noteCheck.detail}`; }
  else if (replay.result === "fail") { verdict = "REFUSE"; reason = `replay: ${replay.detail}`; }
  if (dry) {
    log(`dry ruling ${name}:`, { verdict, reason, checks: checks.map((c) => `${c.name}=${c.result}: ${c.detail}`), gate: AMEND_GATE });
    return;
  }
  if (opts.owner !== undefined && opts.tip !== undefined && opts.tip !== tip) {
    log(`decision ${opts.decision} on ${name} names tip ${opts.tip.slice(0, 10)}, but the tip is now ${tip.slice(0, 10)}; not carried out`);
    return;
  }
  if (verdict === "ADMIT" && opts.owner === "refuse") {
    verdict = "REFUSE";
    reason = `owner: refused the amendment (decision ${opts.decision ?? "?"})`;
  } else if (verdict === "ADMIT" && opts.owner === undefined && AMEND_GATE === "human") {
    const added = (await sh($`git -C ${dir} diff -U0 ${base} HEAD -- SPEC.md CONTRACT.md`, "diff additions")).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
    const files = (await sh($`git -C ${dir} diff --name-only ${base} HEAD`, "diff")).split("\n").filter(Boolean);
    const cite = cited === null ? "a recorded verdict" : `${cited.verdict} on ${cited.objective} at ${cited.ruled_at}`;
    const record = amendmentRecord({ candidate: name, key: `${name} ${tip}`, added, files, cited: cite, replay: replay.detail, reason: String(note?.reason ?? "") });
    const c = routed ?? await proposeRed({
      kind: "amendment", subject: name, record, added,
      spec: await $`git -C ${dir} show ${`${base}:SPEC.md`}`.nothrow().quiet().text(),
      contract: await $`git -C ${dir} show ${`${base}:CONTRACT.md`}`.nothrow().quiet().text(),
      reference: cited === null ? undefined : await referenceOf(cited.canonical, cited.objective),
    });
    log(`decision for ${name}:`, { kind: "amendment", class: c.cls, choice: c.choice, added: added.length });
    if (c.cls === "red") return;
    if (c.choice !== "admit") {
      verdict = "REFUSE";
      reason = `authority under GYR ${c.cls}: ${c.reason}`.slice(0, 500);
    }
  }

  let merge: string | null = null;
  let tag: string | null = null;
  const ruledAt = new Date().toISOString();
  if (verdict === "ADMIT") {
    try {
      ({ merge, tag } = await mergeAndRelease(name, remote, token, SPEC, objective, tip, { verdict, reason, checks, ruledAt }));
    } catch (err) {
      if (!(err instanceof MergeConflict)) throw err;
      verdict = "SEND_BACK";
      reason = `merge into spec conflicts; fetch spec main, merge it, and push again (${err.message.slice(0, 160)})`;
    }
  }
  await postRuling({ name, dir, remote, token, canonical: SPEC, objective, tip, verdict, reason, checks, ruledAt, merge, tag });
  await recordRuling(name, verdict, reason, tag, { askFile: "", outside: [], decisive: false });
}

// The authority's private reference for an ask, which the GYR gate reads as the truth of what the
// arena does. It never reaches the board.
async function referenceOf(canonical: string, objective: string): Promise<{ objective: string; text: string } | undefined> {
  const ext = canonical === "api" ? "ts" : canonical === "site" ? "js" : null;
  if (ext === null) return undefined;
  const file = Bun.file(join(ROOT, "canonicals", "reference", canonical, `${objective}.${ext}`));
  return (await file.exists()) ? { objective, text: await file.text() } : undefined;
}

// Re-runs the judge that sent the cited candidate back, on the cited commit. Measured means it
// still fails: the hidden check draws fresh inputs, so it gets three tries to reproduce.
async function replayCited(v: CitableVerdict, state: ArenaState): Promise<Check> {
  const kind = replayKind(v);
  if (kind === null) return { name: "replay", result: "pass", detail: `cites a recorded ${v.verdict}; nothing to replay` };
  if (!state.repos.some((r) => r.name === v.candidate)) return { name: "replay", result: "fail", detail: `${v.candidate} no longer exists to replay` };
  const token = await mintToken(v.candidate);
  const dir = join(WORKDIR, "replay", v.candidate);
  await clone(v.candidate, token, dir);
  await sh($`git -C ${dir} checkout --quiet ${v.commit}`, "checkout cited commit");
  for (let i = 1; i <= 3; i++) {
    const failed = kind === "hidden"
      ? (await hiddenCheck(dir, v.canonical, v.objective)).result === "fail"
      : !(await sandboxTest(dir, `checks/${v.objective}.test.ts`)).ok;
    if (failed) return { name: "replay", result: "pass", detail: `the ${kind} check still refuses ${v.objective} at ${v.commit.slice(0, 10)} (try ${i})` };
  }
  return { name: "replay", result: "fail", detail: `the ${kind} check now passes ${v.objective} at ${v.commit.slice(0, 10)} in 3 tries; the cited failure is not reproduced` };
}

// The admission note on the candidate's tip, under any earlier rulings, then the verdict row.
async function postRuling(r: {
  name: string; dir: string; remote: string; token: string; canonical: string; objective: string; tip: string;
  verdict: Verdict; reason: string; checks: Check[]; ruledAt: string; merge: string | null; tag: string | null;
}): Promise<void> {
  const admission = { contract: CONTRACT_ID, candidate: r.name, verdict: r.verdict, reason: r.reason, checks: r.checks, commit: r.tip, ruled_at: r.ruledAt, merge_commit: r.merge, tag: r.tag };
  const notePath = join(WORKDIR, "admission", `${r.name}.admission.json`);
  await Bun.write(notePath, JSON.stringify(admission, null, 2));
  await $`git -C ${r.dir} -c ${auth(r.token)} fetch --quiet ${r.remote} +refs/notes/admission:refs/notes/admission`.nothrow().quiet();
  await sh($`git -C ${r.dir} notes --ref=admission add -f -F ${notePath} HEAD`, "notes add admission");
  await sh($`git -C ${r.dir} -c ${auth(r.token)} push --quiet ${r.remote} refs/notes/admission`, "push admission note");
  const posted = await api("/api/arena/verdicts", {
    candidate: r.name, canonical: r.canonical, objective: r.objective, verdict: r.verdict, reason: r.reason.slice(0, 500), commit: r.tip,
    note_ref: "refs/notes/admission", merge_commit: r.merge ?? undefined, tag: r.tag ?? undefined,
  });
  log(`verdict ${r.name}:`, { verdict: r.verdict, reason: r.reason, checks: r.checks.map((c) => `${c.name}=${c.result}`), merge: r.merge, tag: r.tag, recorded: posted.ok });
  await recordOutcome(r.name, r.canonical, r.tip, r.verdict, r.reason);
}

// ISSUE-00034: every ruling is also one outcome on the contributor's standing (SPEC 17.5). The
// ledger's key makes a re-ruled tip score once. A failure here never undoes the ruling.
async function recordOutcome(candidate: string, canonical: string, tip: string, verdict: string, reason: string): Promise<void> {
  const kind = outcomeFromRuling(verdict, reason);
  await postQuality(candidate, { canonical, candidate, tip, kind, reason: reason.slice(0, 500), source: "authority" });
}

// Three tries with backoff: the ledger key makes a retry safe. A lost event stays recoverable with
// scripts/standing.ts backfill --apply, which posts every recorded verdict again.
async function postQuality(candidate: string, body: Record<string, unknown>): Promise<void> {
  let posted: Record<string, unknown> = { ok: false };
  for (let attempt = 0; attempt < 3; attempt++) {
    posted = await api("/api/arena/quality", body).catch((err: unknown) => ({ ok: false, error: String(err) }));
    if (posted.ok === true || posted.status === 400 || posted.status === 409) break;
    await pause(2000 * 2 ** attempt);
  }
  log(`outcome ${candidate}:`, { kind: body.kind, recorded: posted.ok, inserted: posted.inserted ?? null, error: posted.error ?? null });
}

// A human waived a scope refusal (a red record's approval): that refusal no longer counts against
// the contributor. One correction per refused tip, named by the tip.
async function correctWaivedRefusal(candidate: string, canonical: string, tip: string, state: ArenaState): Promise<void> {
  const refused = state.verdicts.some((v) => v.candidate === candidate && v.commit === tip && v.verdict === "REFUSE" && (v.reason ?? "").startsWith("scope:"));
  if (!refused) return;
  await postQuality(candidate, {
    canonical, candidate, tip, kind: "correction", delta: -REVIEW_POLICY_V0.deltas.policy_violation, ref: `waiver-${tip.slice(0, 12)}`,
    reason: `a human waived the scope refusal of ${tip.slice(0, 12)}`, source: "authority",
  });
}

// The standings the review queue reads, one call per watch cycle. A failure orders by push time.
async function standingsByPair(): Promise<Map<string, Standing>> {
  const r = await api("/api/arena/standings").catch(() => ({ ok: false }));
  const list = Array.isArray((r as { standings?: unknown }).standings) ? (r as { standings: Standing[] }).standings : [];
  return new Map(list.map((s) => [`${s.canonical}|${s.contributor}`, s]));
}

class MergeConflict extends Error {}

async function mergeAndRelease(
  name: string, candidateRemote: string, candidateToken: string, canonical: string, objective: string, tip: string,
  ruling: { verdict: string; reason: string; checks: Check[]; ruledAt: string },
): Promise<{ merge: string; tag: string }> {
  const token = await mintToken(canonical);
  const dir = join(WORKDIR, "merge", canonical);
  const remote = await clone(canonical, token, dir);
  await identity(dir, canonical);
  // Interpolated so Bun's shell does not glob it; a failure here must stop the release, or the
  // new notes would be born without the canonical's history and their push would be rejected.
  await sh($`git -C ${dir} -c ${auth(token)} fetch --quiet ${remote} ${"+refs/notes/*:refs/notes/*"}`, "fetch canonical notes");
  await sh($`git -C ${dir} -c ${auth(candidateToken)} fetch --quiet ${candidateRemote} main:refs/candidates/tip +refs/notes/commits:refs/notes/incoming`, "fetch candidate");
  await sh($`git -C ${dir} checkout --quiet -b ${`admit/${name}`}`, "checkout");
  const merged = await $`git -C ${dir} merge --no-ff --quiet -m ${`Admit ${name}: ${objective}`} refs/candidates/tip`.nothrow().quiet();
  if (merged.exitCode !== 0) {
    await $`git -C ${dir} merge --abort`.nothrow().quiet();
    throw new MergeConflict(merged.stderr.toString().trim() || merged.stdout.toString().trim() || "merge conflict");
  }
  const merge = await sh($`git -C ${dir} rev-parse HEAD`, "rev-parse merge");
  const tag = await nextTag(dir);
  await sh($`git -C ${dir} notes merge --quiet -s cat_sort_uniq refs/notes/incoming`, "notes merge");
  const notePath = join(WORKDIR, "merge", `${canonical}.admission.json`);
  await Bun.write(notePath, JSON.stringify({ contract: CONTRACT_ID, candidate: name, ...ruling, commit: tip, merge_commit: merge, tag }, null, 2));
  await sh($`git -C ${dir} notes --ref=admission add -f -F ${notePath} ${tip}`, "notes add admission");
  await sh($`git -C ${dir} tag -a ${tag} -m ${`Release ${tag}: admits ${name} (${objective})`}`, "tag");
  await sh($`git -C ${dir} -c ${auth(token)} push --quiet ${remote} HEAD:refs/heads/main`, "push main");
  await sh($`git -C ${dir} -c ${auth(token)} push --quiet ${remote} refs/notes/commits refs/notes/admission`, "push notes");
  await sh($`git -C ${dir} -c ${auth(token)} push --quiet ${remote} ${`refs/tags/${tag}`}`, "push tag");
  if (canonical === "api") await deployApi(dir);
  return { merge, tag };
}

// The api canonical is the product's server. Wrangler bundles it; nothing in it runs here.
// AGENT_COLLAB_API_WORKER renames the observatory api Worker for this installation, so a second
// installation in one account never deploys over the first one's (ISSUE-00035).
async function deployApi(dir: string): Promise<void> {
  const name = process.env.AGENT_COLLAB_API_WORKER;
  const rename = name !== undefined && name !== "" ? ["--name", name] : [];
  const r = await $`${WRANGLER} deploy ${rename}`.cwd(dir).nothrow().quiet();
  const out = r.stdout.toString();
  log("deploy api:", { exit: r.exitCode, version: out.match(/Current Version ID: (\S+)/)?.[1] ?? null });
  if (r.exitCode !== 0) throw new Error(redact(`api deploy failed: ${r.stderr.toString().slice(-300)}`));
}

// ---------------------------------------------------------------- watch

// ISSUE-00025: the watch subscribes to the control Worker's change stream and wakes on a push, a
// claim or a human's control, instead of always sleeping the full cycle. The 10 s sleep stays as the
// fallback, so a dropped socket costs only latency. Its own verdicts and records do not wake it.
let wake: (() => void) | null = null;
// A deploy can leave a socket that never closes on this side: ping every 30 s, and replace a socket
// that has heard nothing, not even a pong, for 75 s.
let stream: { ws: WebSocket; heard: number } | null = null;
const keepAlive = (): void => {
  if (stream === null) return;
  if (Date.now() - stream.heard > 75_000) {
    log("watch: change stream silent for 75 s; reconnecting");
    const dead = stream.ws;
    stream = null;
    dead.onclose = null;
    dead.close();
    subscribeChanges();
  } else if (stream.ws.readyState === WebSocket.OPEN) stream.ws.send("ping");
};
function subscribeChanges(): void {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/arena/subscribe`, { headers: { authorization: `Bearer ${adminKey}` } });
  stream = { ws, heard: Date.now() };
  ws.onopen = () => log("watch: subscribed to the change stream");
  ws.onmessage = (m) => {
    if (stream?.ws === ws) stream.heard = Date.now();
    let c: { kind?: string; status?: string; class?: string } = {};
    try {
      c = JSON.parse(String(m.data)) as typeof c;
    } catch {
      return;
    }
    if (c.kind === "push" || c.kind === "claim" || (c.kind === "decision" && c.class === "red" && c.status === "decided")) wake?.();
  };
  ws.onclose = () => {
    if (stream?.ws !== ws) return;
    stream = null;
    setTimeout(subscribeChanges, 5_000);
  };
}
async function pause(ms: number): Promise<void> {
  await Promise.race([Bun.sleep(ms), new Promise<void>((resolve) => { wake = resolve; })]);
  wake = null;
}

async function watch(): Promise<void> {
  const firstSeen = new Map<string, number>();
  const failed = new Set<string>();
  log(`watch: started; GYR gate ${GYR_GATE}${GYR_GATE === "off" ? ": every proposed red waits for the human" : ""}`);
  subscribeChanges();
  setInterval(keepAlive, 30_000);
  for (;;) {
    try {
      await actOnDecisions(failed);
      const state = await arenaState();
      const canonHashes = new Map<string, Set<string>>();
      for (const c of ["api", "site", SPEC]) canonHashes.set(c, new Set((await repoInfo(c)).hashes));
      // Selection rule (CONTRACT.md, ruled 2026-10-07, ISSUE-00009): earliest completed submission
      // wins. Rule candidates in the order of their last push (branch or note), oldest first, so
      // the earliest passer is ADMITTED and later passers on that ask are REFUSED on first.
      const lastPush = (name: string): number => Math.max(0, ...state.events.filter((e) => e.repo === name && (e.ref === "refs/heads/main" || e.ref === "refs/notes/commits")).map((e) => Date.parse(e.received_at)));
      // ISSUE-00034: contributor standing orders the queue across objectives only; within one
      // objective push order stands, so the earliest passer still wins (SPEC 17.4, 17.5).
      const standings = await standingsByPair();
      const pending: PendingCandidate[] = state.repos
        .filter((x) => x.role === "candidate" && (x.parent === "api" || x.parent === "site" || x.parent === SPEC))
        .map((x) => ({ name: x.name, canonical: x.parent ?? "", objective: x.name.split("--")[1] ?? "", contributor: contributorOf(x.name) ?? "", pushedAt: lastPush(x.name) }));
      const ordered = orderReviewQueue(pending, (c, who) => standings.get(`${c}|${who}`) ?? deriveStanding([], c, who), Date.now())
        .map((p) => ({ name: p.name, parent: p.canonical }));
      for (const r of ordered) {
        if (r.name.split("--")[1] === "feed-iso8601") continue;
        const { head } = await repoInfo(r.name);
        if (head === null || canonHashes.get(r.parent ?? "")?.has(head)) continue;
        // A ruled head is re-opened only by a notes push after its latest ruling: the fix for a
        // missing or wrong note changes no branch commit.
        const ruledAt = Math.max(0, ...state.verdicts.filter((v) => v.candidate === r.name && v.commit === head).map((v) => Date.parse(v.ruled_at)));
        const notesPushes = state.events.filter((e) => e.repo === r.name && e.ref === "refs/notes/commits");
        if (ruledAt > 0 && !notesPushes.some((e) => Date.parse(e.received_at) > ruledAt)) continue;
        const key = `${r.name} ${head} ${ruledAt}`;
        if (failed.has(key)) continue;
        const seen = firstSeen.get(key) ?? Date.now();
        firstSeen.set(key, seen);
        const lastMain = Math.max(0, ...state.events.filter((e) => e.repo === r.name && e.ref === "refs/heads/main").map((e) => e.id));
        const notesAfter = notesPushes.some((e) => e.id > lastMain && Date.parse(e.received_at) > ruledAt);
        if (!notesAfter && Date.now() - seen < 120_000) continue;
        try {
          await admitCandidate(r.name, await arenaState());
        } catch (err) {
          failed.add(key);
          log(`admission error ${r.name}:`, String(err).slice(0, 400));
          await postErrorRecord(r.name, key, String(err), failed);
        }
      }
    } catch (err) {
      log("watch cycle error:", String(err).slice(0, 300));
    }
    await pause(10_000);
  }
}

const [cmd, arg, ...rest] = process.argv.slice(2);
await mkdir(WORKDIR, { recursive: true });
if (cmd === "publish" && arg !== undefined) await publish(arg, rest.join(" ") || `Publish ${arg} seed`);
else if (cmd === "admit" && arg !== undefined && rest[0] === "--dry") await admitAmendment(arg, arg.split("--")[1] ?? "", await arenaState(), { dry: true });
else if (cmd === "admit" && arg !== undefined) await admitCandidate(arg, await arenaState());
else if (cmd === "watch") await watch();
else if (cmd === "pull-spec") await pullSpec();
else throw new Error("usage: publish <spec|api|site> [message] | pull-spec | admit <candidate> | watch");
