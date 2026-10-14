#!/usr/bin/env bun
// Lists, and with --delete removes, every resource one agent-collab installation owns (ISSUE-00042,
// SPEC 17.6). The inverse of install.ts: same environment, same names, derived from the prefix.
//
//   bun scripts/uninstall.ts [--env test] [--delete] [--config <dir>]
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment. Without --delete it only
// lists and exits 0. With --delete it removes, in the order the platform accepts, the event
// subscriptions, the queue, the Workers, the repositories and the namespaces, lists again, and exits
// 0 only when every listed resource is absent; otherwise it prints what remains and exits 1.
// A name that does not start with the prefix and a hyphen is reported and skipped, never deleted.
// With --delete it also removes the private files install.ts wrote to --config. Prints no key,
// token, account id or URL; an error names the resource and the HTTP status only.
import { existsSync } from "node:fs";
import { readdir, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const API = "https://api.cloudflare.com/client/v4";
// The files install.ts writes under --config; nothing else is ever removed.
const CONFIG_FILES = ["url", "admin.key", "viewer.key", "env"] as const;
const DELETE_ROUNDS = 3;

export type Kind = "subscription" | "queue" | "worker" | "repository" | "namespace";
// Platform order: a subscription points at a queue and a repo, the Worker consumes the queue, and a
// namespace must be empty of repositories before it goes.
export const DELETE_ORDER: readonly Kind[] = ["subscription", "queue", "worker", "repository", "namespace"];

export interface CfResult {
  status: number;
  json: { success?: boolean; result?: unknown; result_info?: { total_pages?: number }; errors?: unknown };
}
// The one network seam: the same shape as install.ts cf(), with the account path already applied.
export type Cf = (method: string, path: string, body?: unknown) => Promise<CfResult>;

export interface Options {
  prefix: string;
  doDelete: boolean;
  configDir: string;
  sleepMs?: number;
  out?: (line: string) => void;
}
interface Resource {
  kind: Kind;
  label: string;
  deletePath: string;
}
interface Inventory {
  owned: Resource[];
  skipped: string[];
}

/** True only for a name that starts with the prefix followed by a hyphen, with something after it. */
export function ownsName(prefix: string, name: string): boolean {
  return prefix !== "" && name.startsWith(`${prefix}-`) && name.length > prefix.length + 1;
}

export function installationNames(prefix: string): { worker: string; api: string; arena: string; comms: string; queue: string } {
  return { worker: `${prefix}-control`, api: `${prefix}-api`, arena: `${prefix}-arena`, comms: `${prefix}-comms`, queue: `${prefix}-events` };
}

/** RESOURCE_PREFIX of the env in wrangler.jsonc, or the top-level default when no env is named. */
export function prefixFor(wranglerText: string, envName: string | undefined): string {
  if (envName === undefined) return "agent-collab";
  const plain = wranglerText
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ""))
    .replace(/,(\s*[}\]])/g, "$1");
  const config = JSON.parse(plain) as { env?: Record<string, { vars?: { RESOURCE_PREFIX?: string } }> };
  const prefix = config.env?.[envName]?.vars?.RESOURCE_PREFIX;
  if (typeof prefix !== "string" || prefix === "") throw new Error(`wrangler.jsonc env.${envName} has no RESOURCE_PREFIX`);
  return prefix;
}

function rows(json: CfResult["json"]): Record<string, unknown>[] {
  return Array.isArray(json.result) ? (json.result as Record<string, unknown>[]) : [];
}

async function inventory(prefix: string, cf: Cf): Promise<Inventory> {
  const n = installationNames(prefix);
  const namespaces = [n.arena, n.comms];
  const owned: Resource[] = [];
  const skipped: string[] = [];

  // Event subscriptions: by name guard, and only those on this installation's own namespaces, so a
  // prefix that is itself the front of another installation's prefix cannot reach into it.
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await cf("GET", `/event_subscriptions/subscriptions?page=${page}&per_page=50`);
    if (res.status !== 200) throw new Error(`list subscriptions: HTTP ${res.status}`);
    pages = res.json.result_info?.total_pages ?? 1;
    for (const s of rows(res.json)) {
      const name = String(s.name ?? "");
      const source = (s.source ?? {}) as { namespace?: unknown };
      if (typeof source.namespace !== "string" || !namespaces.includes(source.namespace)) continue;
      if (!ownsName(prefix, name)) skipped.push(`subscription ${name}: outside prefix`);
      else owned.push({ kind: "subscription", label: name, deletePath: `/event_subscriptions/subscriptions/${String(s.id)}` });
    }
  }

  const queues = await cf("GET", `/queues?name=${n.queue}`);
  if (queues.status !== 200) throw new Error(`list queues: HTTP ${queues.status}`);
  for (const q of rows(queues.json)) {
    const name = String(q.queue_name ?? "");
    if (!ownsName(prefix, name)) skipped.push(`queue ${name}: outside prefix`);
    else if (name === n.queue) owned.push({ kind: "queue", label: name, deletePath: `/queues/${String(q.queue_id)}` });
  }

  const scripts = await cf("GET", "/workers/scripts");
  if (scripts.status !== 200) throw new Error(`list workers: HTTP ${scripts.status}`);
  const present = new Set(rows(scripts.json).map((w) => String(w.id ?? "")));
  // The control Worker first: it holds the service binding to the api Worker.
  for (const name of [n.worker, n.api]) {
    if (present.has(name) && ownsName(prefix, name)) owned.push({ kind: "worker", label: name, deletePath: `/workers/scripts/${name}?force=true` });
  }

  for (const ns of namespaces) {
    if (!ownsName(prefix, ns)) {
      skipped.push(`namespace ${ns}: outside prefix`);
      continue;
    }
    const repos = await cf("GET", `/artifacts/namespaces/${ns}/repos`);
    if (repos.status === 200) {
      for (const r of rows(repos.json)) {
        owned.push({ kind: "repository", label: `${ns}/${String(r.name)}`, deletePath: `/artifacts/namespaces/${ns}/repos/${String(r.name)}` });
      }
    } else if (repos.status !== 404) throw new Error(`list repositories ${ns}: HTTP ${repos.status}`);
    const exists = await cf("GET", `/artifacts/namespaces/${ns}`);
    if (exists.status === 200) owned.push({ kind: "namespace", label: ns, deletePath: `/artifacts/namespaces/${ns}` });
    else if (exists.status !== 404) throw new Error(`namespace ${ns}: HTTP ${exists.status}`);
  }
  return { owned, skipped };
}

async function removeConfigFiles(dir: string, out: (line: string) => void): Promise<void> {
  for (const name of CONFIG_FILES) {
    const path = join(dir, name);
    if (existsSync(path)) {
      await unlink(path);
      out(`removed private file ${name}`);
    }
  }
  if (existsSync(dir) && (await readdir(dir)).length === 0) {
    await rmdir(dir);
    out("removed the empty config directory");
  }
}

/** Returns the process exit code. Every network call goes through cf. */
export async function run(opts: Options, cf: Cf): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const report = (inv: Inventory): void => {
    for (const r of inv.owned) out(`${r.kind} ${r.label}`);
    for (const s of inv.skipped) out(`skipped ${s}`);
  };
  let inv = await inventory(opts.prefix, cf);
  out(`${inv.owned.length} resources under prefix ${opts.prefix}-`);
  report(inv);
  if (!opts.doDelete) return 0;

  for (let round = 1; round <= DELETE_ROUNDS && inv.owned.length > 0; round++) {
    for (const kind of DELETE_ORDER) {
      for (const r of inv.owned.filter((x) => x.kind === kind)) {
        // Second guard at the point of deletion: the label's own name part must carry the prefix.
        const name = r.label.split("/")[0] ?? "";
        if (r.kind !== "repository" && !ownsName(opts.prefix, name)) continue;
        const res = await cf("DELETE", r.deletePath);
        out(`delete ${r.kind} ${r.label}: HTTP ${res.status}`);
      }
    }
    if (opts.sleepMs !== 0) await Bun.sleep(opts.sleepMs ?? 3000);
    inv = await inventory(opts.prefix, cf);
  }
  if (inv.owned.length > 0) {
    out(`${inv.owned.length} resources remain`);
    report(inv);
    return 1;
  }
  out("every listed resource is absent");
  await removeConfigFiles(opts.configDir, out);
  return 0;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const envName = arg("--env");
  if (envName !== undefined && envName !== "test") throw new Error("--env accepts only test (wrangler.jsonc env.test)");
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  if (token === "" || account === "") throw new Error("export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first");
  const cf: Cf = async (method, path, body) => {
    const res = await fetch(`${API}/accounts/${account}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as CfResult["json"] };
  };
  const prefix = prefixFor(await Bun.file(join(ROOT, "wrangler.jsonc")).text(), envName);
  process.exitCode = await run({ prefix, doDelete: process.argv.includes("--delete"), configDir: resolve(arg("--config") ?? join(ROOT, ".agent-collab")) }, cf);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "uninstall failed");
    process.exitCode = 1;
  });
}
