#!/usr/bin/env bun
// Installs one agent-collab Project Authority on a Cloudflare account (ISSUE-00035, SPEC 17.6).
// Every step checks before it creates, so a second run repairs and changes nothing that exists.
//
//   bun scripts/install.ts [--env test] [--config <dir>]
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment, Bun, git, and a Workers
// Paid plan with Artifacts. Writes the installation's private values to --config (default
// .agent-collab/, gitignored): url, admin.key, viewer.key and env, the file the authority reads.
// Prints no key, token or account id.
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");
const API = "https://api.cloudflare.com/client/v4";
const CANONICALS = ["spec", "api", "site"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const envName = arg("--env");
if (envName !== undefined && envName !== "test") throw new Error("--env accepts only test (wrangler.jsonc env.test)");
const prefix = envName === "test" ? "agent-collab-test" : "agent-collab";
const names = { worker: `${prefix}-control`, arena: `${prefix}-arena`, comms: `${prefix}-comms`, queue: `${prefix}-events`, api: `${prefix}-api` };
const configDir = resolve(arg("--config") ?? join(ROOT, ".agent-collab"));
const envFlag = envName === undefined ? [] : ["--env", envName];

const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
if (token === "" || account === "") throw new Error("export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first");
const redact = (s: string): string => s.replaceAll(account, "<account>").replaceAll(token, "<token>").replace(/https:\/\/[^\s"]+workers\.dev/g, "<url>");
const step = (n: number, what: string): void => console.log(`${n}. ${what}`);

async function cf(method: string, path: string, body?: unknown): Promise<{ status: number; json: { success?: boolean; result?: unknown; errors?: unknown } }> {
  const res = await fetch(`${API}/accounts/${account}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { success?: boolean } };
}

async function ensureNamespace(namespace: string): Promise<void> {
  if ((await cf("GET", `/artifacts/namespaces/${namespace}`)).status === 200) return console.log(`   namespace ${namespace}: exists`);
  const created = await cf("POST", "/artifacts/namespaces", { namespace, jurisdiction: "us" });
  if (created.json.success !== true) throw new Error(`namespace ${namespace}: HTTP ${created.status} ${redact(JSON.stringify(created.json.errors))}`);
  console.log(`   namespace ${namespace}: created`);
}

async function ensureQueue(queue: string): Promise<void> {
  const list = await cf("GET", `/queues?name=${queue}`);
  const found = (list.json.result as { queue_name: string }[] | undefined)?.some((q) => q.queue_name === queue) ?? false;
  if (found) return console.log(`   queue ${queue}: exists`);
  const created = await cf("POST", "/queues", { queue_name: queue });
  if (created.json.success !== true) throw new Error(`queue ${queue}: HTTP ${created.status} ${redact(JSON.stringify(created.json.errors))}`);
  console.log(`   queue ${queue}: created`);
}

async function keyFile(name: string): Promise<string> {
  const path = join(configDir, name);
  if (!existsSync(path)) {
    await Bun.write(path, `${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}\n`);
    await chmod(path, 0o600);
  }
  return (await Bun.file(path).text()).trim();
}

async function putSecret(name: string, value: string): Promise<void> {
  // Bun Shell has no .stdin(); a Buffer redirect feeds the value without a shell or a temp file.
  const r = await $`${WRANGLER} secret put ${name} ${envFlag} < ${Buffer.from(value)}`.cwd(ROOT).nothrow().quiet();
  if (r.exitCode !== 0) throw new Error(`secret ${name}: ${redact(r.stderr.toString()).slice(-300)}`);
  console.log(`   secret ${name}: set`);
}

async function admin(url: string, key: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

await mkdir(configDir, { recursive: true });
await chmod(configDir, 0o700);

step(1, `Artifacts namespaces and the events queue (${prefix})`);
await ensureNamespace(names.arena);
await ensureNamespace(names.comms);
await ensureQueue(names.queue);

step(2, `deploy the control Worker ${names.worker}`);
const deployed = await $`${WRANGLER} deploy ${envFlag}`.cwd(ROOT).nothrow().quiet();
const deployOut = `${deployed.stdout.toString()}${deployed.stderr.toString()}`;
if (deployed.exitCode !== 0) throw new Error(`deploy: ${redact(deployOut).slice(-400)}`);
const url = deployOut.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
if (url === undefined) throw new Error("deploy printed no workers.dev URL; is workers_dev enabled?");
await Bun.write(join(configDir, "url"), `${url}\n`);
console.log(`   version ${deployOut.match(/Current Version ID: (\S+)/)?.[1] ?? "unknown"}`);

step(3, "secrets: admin, viewer, push-subscription credentials");
const adminKey = await keyFile("admin.key");
const viewerKey = await keyFile("viewer.key");
await putSecret("ADMIN_KEY", adminKey);
await putSecret("VIEWER_KEY", viewerKey);
await putSecret("CF_API_TOKEN", token);
await putSecret("CF_ACCOUNT_ID", account);

step(4, "wait for the Worker to answer with the new secrets");
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  ready = (await admin(url, viewerKey, "GET", "/api/state").catch(() => ({ status: 0, json: {} }))).status === 200;
  if (!ready) await Bun.sleep(3000);
}
if (!ready) throw new Error("the Worker did not answer /api/state with 200 within two minutes");
console.log("   GET /api/state: 200");

step(5, "canonicals spec, api and site, seeded from this repository");
const state = await admin(url, viewerKey, "GET", "/api/state");
const existing = new Set(((state.json.repos ?? []) as { name: string }[]).map((r) => r.name));
for (const c of CANONICALS) {
  if (existing.has(c)) {
    console.log(`   canonical ${c}: exists`);
    continue;
  }
  const r = await admin(url, adminKey, "POST", "/api/canonicals", { name: c, description: `agent-collab canonical ${c}` });
  if (r.json.ok !== true) throw new Error(`canonical ${c}: HTTP ${r.status} ${redact(JSON.stringify(r.json.error ?? ""))}`);
  console.log(`   canonical ${c}: created`);
}
const authorityEnv = [
  `CLOUDFLARE_ACCOUNT_ID=${account}`,
  `AGENT_COLLAB_URL=${url}`,
  `AGENT_COLLAB_ADMIN_KEY_FILE=${join(configDir, "admin.key")}`,
  `AGENT_COLLAB_API_WORKER=${names.api}`,
  "",
].join("\n");
await Bun.write(join(configDir, "env"), authorityEnv);
await chmod(join(configDir, "env"), 0o600);
for (const c of CANONICALS) {
  // Each secret put is a new Worker version; for a few seconds an edge can still serve one that
  // rejects the admin key with a plain 404. Publish is idempotent, so a retry is safe.
  let r = await $`bun --env-file=${join(configDir, "env")} scripts/authority.ts publish ${c} ${`Publish ${c} seed`}`.cwd(ROOT).nothrow().quiet();
  for (let i = 0; i < 4 && r.exitCode !== 0; i++) {
    await Bun.sleep(5000);
    r = await $`bun --env-file=${join(configDir, "env")} scripts/authority.ts publish ${c} ${`Publish ${c} seed`}`.cwd(ROOT).nothrow().quiet();
  }
  if (r.exitCode !== 0) throw new Error(`publish ${c}: ${redact(`${r.stdout}${r.stderr}`).slice(-400)}`);
  console.log(`   publish ${c}: done`);
}

step(6, "check: the asks ledger reads the published spec");
const asks = await admin(url, viewerKey, "GET", "/api/asks");
console.log(`   GET /api/asks: ${asks.status}, ${((asks.json.asks ?? []) as unknown[]).length} asks`);
if (asks.status !== 200) throw new Error("the asks ledger did not answer 200");

console.log(`
Installed. Private values are in ${configDir} (mode 700); keep them out of git.
Next:
  - Run the authority:  bun --env-file=${join(configDir, "env")} scripts/authority.ts watch
  - Open the board:     the url file, then /o/<the viewer key> in a browser
  - Invite a contributor: see README.md, "Invite a contributor"`);
