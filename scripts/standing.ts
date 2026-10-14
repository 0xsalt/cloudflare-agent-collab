#!/usr/bin/env bun
// Contributor standing, operator commands (ISSUE-00034, SPEC 17.5).
//
//   bun scripts/standing.ts show                    the standings the Worker derives (admin key)
//   bun scripts/standing.ts backfill [--apply]      map every recorded verdict to one outcome event
//   bun scripts/standing.ts correct <candidate> <tip> <delta> <ref> <reason...>
//
// backfill prints what it would post and the standings that would result; --apply posts. The
// ledger key makes a second backfill a no-op. Reads the authority's environment:
// AGENT_COLLAB_URL and AGENT_COLLAB_ADMIN_KEY_FILE (bun --env-file=<private env file>).
import { homedir } from "node:os";
import { deriveStanding, outcomeFromRuling, validateEvent, type QualityEvent } from "../src/reputation";

const base = process.env.AGENT_COLLAB_URL ?? "";
const keyFile = (process.env.AGENT_COLLAB_ADMIN_KEY_FILE ?? "").replace(/^~(?=\/)/, homedir());
if (base === "" || keyFile === "") throw new Error("set AGENT_COLLAB_URL and AGENT_COLLAB_ADMIN_KEY_FILE");
const key = (await Bun.file(keyFile).text()).trim();

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ...((await res.json().catch(() => ({}))) as Record<string, unknown>) };
}

interface VerdictRow { candidate: string; canonical: string; verdict: string; reason: string; commit: string; ruled_at: string }

async function backfill(apply: boolean): Promise<void> {
  const state = await api("/api/state");
  const verdicts = (state.verdicts ?? []) as VerdictRow[];
  const bodies = verdicts.map((v) => ({
    canonical: v.canonical, candidate: v.candidate, tip: v.commit, kind: outcomeFromRuling(v.verdict, v.reason),
    reason: `backfill: ${v.verdict} ${v.reason}`.slice(0, 500), source: "authority", at: v.ruled_at,
  }));
  const events: QualityEvent[] = [];
  let invalid = 0;
  for (const b of bodies) {
    const r = validateEvent(b);
    if (r.ok) events.push(r.event);
    else invalid++;
  }
  const pairs = [...new Set(events.map((e) => `${e.canonical}|${e.contributor}`))].sort();
  console.log(`verdicts ${verdicts.length}, valid events ${events.length}, invalid ${invalid}`);
  for (const p of pairs) {
    const [canonical = "", contributor = ""] = p.split("|");
    const s = deriveStanding(events, canonical, contributor);
    console.log(`${canonical.padEnd(5)} ${contributor.padEnd(8)} score ${String(s.score).padStart(3)} ${s.tier.padEnd(11)} slots ${s.slots} concurrent ${s.concurrent} (${s.counted} events)`);
  }
  if (!apply) {
    console.log("dry run: nothing posted; rerun with --apply");
    return;
  }
  let inserted = 0;
  for (const e of events) {
    const r = await api("/api/arena/quality", { canonical: e.canonical, candidate: e.candidate, tip: e.tip, kind: e.kind, reason: e.reason, source: "authority", at: e.at });
    if (r.ok !== true) throw new Error(`post failed for ${e.candidate}: ${String(r.error)}`);
    if (r.inserted === true) inserted++;
  }
  console.log(`posted ${events.length}, newly stored ${inserted}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "show") {
  console.log(JSON.stringify(await api("/api/arena/standings"), null, 2));
} else if (cmd === "backfill") {
  await backfill(rest.includes("--apply"));
} else if (cmd === "correct" && rest.length >= 5) {
  const [candidate, tip, delta, ref, ...reason] = rest;
  const canonical = (await api("/api/state")).repos as { name: string; parent: string | null }[];
  const parent = canonical.find((r) => r.name === candidate)?.parent;
  if (!parent) throw new Error(`no repo ${candidate}`);
  console.log(JSON.stringify(await api("/api/arena/quality", {
    canonical: parent, candidate, tip, kind: "correction", delta: Number(delta), ref, reason: reason.join(" "), source: "authority",
  })));
} else {
  throw new Error("usage: show | backfill [--apply] | correct <candidate> <tip> <delta> <ref> <reason...>");
}
