// The owner's end of the comms channel (ISSUE-00026). Subcommands:
//   namespace                       create the Artifacts namespace agent-collab-comms when absent
//                                   (needs the host's Cloudflare credentials: scripts/cf-env.sh)
//   setup                           create forge-to-owner and owner-to-forge, subscribe their pushes
//   read [--since <ISO time>]       print every message in both repos, oldest first
//   send --re <subject> --kind <kind> [--class <gyr class>] [--repo <repo>] --title <title> <body file>
//                                   commit one message to owner-to-forge (default) and push it
//
//   sh scripts/cf-env.sh bun --env-file=<private env file> scripts/comms.ts <subcommand>
//
// Tokens are minted per call by the control Worker and never printed.

import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COMMS_NAMESPACE, MESSAGE_KINDS, OWNER_TO_FORGE, formatMessage, isCommsRepo, messagePath, type Message, type MessageKind } from "../src/comms";

const ROOT = join(import.meta.dir, "..");
const WORKDIR = join(ROOT, ".workdirs", "comms");

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`missing environment variable ${name}`);
  return v;
}
const expandHome = (p: string): string => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

async function control(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = (await Bun.file(expandHome(need("AGENT_COLLAB_ADMIN_KEY_FILE"))).text()).trim();
  const res = await fetch(`${need("AGENT_COLLAB_URL")}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}, not JSON` }))) as Record<string, unknown>;
}
const redact = (s: string): string => s.replace(/art_v\d+_[0-9A-Za-z_]+(\?expires=\d+)?/g, "art_<redacted>");

async function namespace(): Promise<void> {
  const api = `https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}/artifacts`;
  const headers = { authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`, "content-type": "application/json" };
  const got = await fetch(`${api}/namespaces/${COMMS_NAMESPACE}`, { headers });
  if (got.status !== 404) {
    console.log(`namespace ${COMMS_NAMESPACE}: HTTP ${got.status}`);
    return;
  }
  const created = await fetch(`${api}/namespaces`, { method: "POST", headers, body: JSON.stringify({ namespace: COMMS_NAMESPACE, jurisdiction: "us" }) });
  const body = (await created.json()) as { success?: boolean; errors?: { message: string }[] };
  console.log(`namespace ${COMMS_NAMESPACE} create: HTTP ${created.status} ${body.success === true ? "ok" : (body.errors?.[0]?.message ?? "failed")}`);
  if (body.success !== true) process.exit(1);
}

async function read(since: string | undefined): Promise<void> {
  const r = await control("/api/comms");
  if (r.ok !== true) throw new Error(`comms read failed: ${JSON.stringify(r).slice(0, 300)}`);
  const repos = r.repos as Record<string, { messages: Message[]; invalid: { path: string; error: string }[] }>;
  const all = Object.values(repos).flatMap((x) => x.messages).filter((m) => since === undefined || m.at > since).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const m of all) console.log(`\n=== ${m.at} ${m.repo} ${m.path}\nfrom ${m.from} to ${m.to} re ${m.re} kind ${m.kind}${m.class ? ` class ${m.class}` : ""}\n\n${m.body}`);
  for (const [name, x] of Object.entries(repos)) for (const bad of x.invalid) console.log(`\n!!! ${name} ${bad.path}: ${bad.error}`);
  console.log(`\n${all.length} message(s)`);
}

async function send(opts: { repo: string; re: string; kind: MessageKind; cls?: Message["class"]; title: string; bodyFile: string }): Promise<void> {
  if (!isCommsRepo(opts.repo)) throw new Error(`repo must be a comms repo, not ${opts.repo}`);
  const body = await Bun.file(opts.bodyFile).text();
  const minted = await control("/api/comms/token", { repo: opts.repo, scope: "write", ttl: 600 });
  if (minted.ok !== true) throw new Error(`token refused: ${redact(JSON.stringify(minted)).slice(0, 300)}`);
  const remote = String(minted.remote);
  const auth = `http.extraHeader=Authorization: Bearer ${String(minted.token)}`;
  const dir = join(WORKDIR, `${opts.repo}-${Date.now()}`);
  await mkdir(WORKDIR, { recursive: true });
  try {
    await $`git -c ${auth} clone --quiet ${remote} ${dir}`.quiet();
    // A local branch: hosts with a commit-to-main guard still push HEAD to the remote main.
    await $`git -C ${dir} checkout --quiet -b outbox`.quiet();
    await $`git -C ${dir} config user.name owner`.quiet();
    await $`git -C ${dir} config user.email owner@agent-collab.invalid`.quiet();
    const path = messagePath(new Date(), opts.title);
    const text = formatMessage({ from: "owner", to: "forge", re: opts.re, kind: opts.kind, class: opts.cls ?? null, body });
    await mkdir(join(dir, "messages"), { recursive: true });
    await Bun.write(join(dir, path), text);
    await $`git -C ${dir} add ${path}`.quiet();
    await $`git -C ${dir} commit --quiet -m ${`${opts.kind}: ${opts.title}`.slice(0, 120)}`.quiet();
    // Message files never collide, so a rejected push only needs the other writer's commits.
    for (let i = 1; ; i++) {
      const pushed = await $`git -C ${dir} -c ${auth} push --quiet ${remote} HEAD:refs/heads/main`.nothrow().quiet();
      if (pushed.exitCode === 0) break;
      if (i === 3) throw new Error(redact(`push failed: ${pushed.stderr.toString().slice(-300)}`));
      await $`git -C ${dir} -c ${auth} pull --quiet --rebase ${remote} main`.nothrow().quiet();
    }
    const head = (await $`git -C ${dir} rev-parse HEAD`.quiet().text()).trim();
    console.log(`sent ${opts.repo} ${path} at ${head.slice(0, 10)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "namespace") await namespace();
else if (cmd === "setup") console.log(redact(JSON.stringify(await control("/api/comms/setup", {}), null, 1)));
else if (cmd === "read") {
  const { values } = parseArgs({ args: rest, options: { since: { type: "string" } } });
  await read(values.since);
} else if (cmd === "send") {
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { re: { type: "string" }, kind: { type: "string" }, class: { type: "string" }, repo: { type: "string" }, title: { type: "string" } },
  });
  const kind = values.kind ?? "";
  const cls = values.class;
  if (values.re === undefined || values.title === undefined || positionals[0] === undefined) throw new Error("send needs --re, --title and a body file");
  if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) throw new Error(`--kind must be one of ${MESSAGE_KINDS.join(", ")}`);
  if (cls !== undefined && cls !== "green" && cls !== "yellow" && cls !== "red") throw new Error("--class must be green, yellow or red");
  await send({ repo: values.repo ?? OWNER_TO_FORGE, re: values.re, kind: kind as MessageKind, cls, title: values.title, bodyFile: positionals[0] });
} else throw new Error("usage: namespace | setup | read [--since <time>] | send --re <subject> --kind <kind> [--class <c>] [--repo <repo>] --title <title> <body file>");
