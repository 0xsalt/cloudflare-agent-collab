#!/usr/bin/env bun
// Invites one contributor to a Project Authority (ISSUE-00016, SPEC 17.1). Mints the WORLD's
// submitter key, sets the Worker secret SUBMITTER_KEYS, waits until the key reads the arena, and
// prints the start card to hand over with the two files.
//
//   bun scripts/invite.ts <world> [--env test] [--config <dir>]
//
// SUBMITTER_KEYS is rebuilt from every submitter-<world>.key in the config directory (default
// .agent-collab/, written by scripts/install.ts), so a deleted key file is revoked on the next
// invite. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, like install.ts. Prints no key.
import { existsSync, readdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";

// The claim route's rule for a WORLD name (src/index.ts, word()): [a-z0-9], 1 to 20 characters.
export const WORLD = /^[a-z0-9]{1,20}$/;
const KEY_FILE = /^submitter-([a-z0-9]{1,20})\.key$/;

/** The start card for one WORLD, from the template the spec canonical serves as START.md. */
export function renderCard(template: string, world: string): string {
  if (!WORLD.test(world)) throw new Error(`WORLD must be [a-z0-9], 1 to 20 characters: ${world}`);
  return template.replaceAll("<world>", world);
}

/** The SUBMITTER_KEYS value, "world=key,world=key", from the key files' names and contents. */
export function submitterKeys(keys: ReadonlyMap<string, string>): string {
  return [...keys.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([w, k]) => `${w}=${k}`).join(",");
}

async function main(): Promise<void> {
  const ROOT = join(import.meta.dir, "..");
  const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const world = process.argv[2] ?? "";
  if (!WORLD.test(world)) throw new Error("usage: bun scripts/invite.ts <world> [--env test] [--config <dir>]; WORLD is [a-z0-9], 1 to 20 characters");
  const envName = arg("--env");
  if (envName !== undefined && envName !== "test") throw new Error("--env accepts only test (wrangler.jsonc env.test)");
  const envFlag = envName === undefined ? [] : ["--env", envName];
  if ((process.env.CLOUDFLARE_API_TOKEN ?? "") === "" || (process.env.CLOUDFLARE_ACCOUNT_ID ?? "") === "") {
    throw new Error("export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first");
  }
  const configDir = resolve(arg("--config") ?? join(ROOT, ".agent-collab"));
  const urlFile = ["url", "agent-collab.url"].map((f) => join(configDir, f)).find((f) => existsSync(f));
  if (urlFile === undefined) throw new Error(`no url or agent-collab.url in ${configDir}; run scripts/install.ts first`);
  const url = (await Bun.file(urlFile).text()).trim();

  const keyPath = join(configDir, `submitter-${world}.key`);
  const minted = !existsSync(keyPath);
  if (minted) {
    await Bun.write(keyPath, `${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}\n`);
    await chmod(keyPath, 0o600);
  }
  const keys = new Map<string, string>();
  for (const f of readdirSync(configDir).sort()) {
    const w = f.match(KEY_FILE)?.[1];
    if (w !== undefined) keys.set(w, (await Bun.file(join(configDir, f)).text()).trim());
  }
  console.log(`1. key for WORLD ${world}: ${minted ? "minted" : "exists"}; SUBMITTER_KEYS names ${[...keys.keys()].join(", ")}`);

  const put = await $`${WRANGLER} secret put SUBMITTER_KEYS ${envFlag} < ${Buffer.from(submitterKeys(keys))}`.cwd(ROOT).nothrow().quiet();
  if (put.exitCode !== 0) throw new Error(`secret SUBMITTER_KEYS: exit ${put.exitCode}`);
  console.log("2. secret SUBMITTER_KEYS: set");

  // A secret put is a new Worker version; wait until the new key reads the asks three times running.
  let streak = 0;
  for (let i = 0; i < 60 && streak < 3; i++) {
    const r = await fetch(`${url}/api/asks`, { headers: { authorization: `Bearer ${keys.get(world)}` } }).catch(() => null);
    streak = r?.status === 200 ? streak + 1 : 0;
    if (streak < 3) await Bun.sleep(2000);
  }
  if (streak < 3) throw new Error("the new key did not read /api/asks within two minutes");
  console.log("3. GET /api/asks with the new key: 200");

  const card = renderCard(await Bun.file(join(ROOT, "canonicals", "spec", "START.md")).text(), world);
  console.log(`
Hand over two files by a channel you trust, then the card below:
  ${urlFile}  ->  ~/.config/cf-git-contest/agent-collab.url
  ${keyPath}  ->  ~/.config/cf-git-contest/submitter-${world}.key
The arena serves the card's template at /api/spec/file/START.md.

${card}`);
}

if (import.meta.main) await main();
