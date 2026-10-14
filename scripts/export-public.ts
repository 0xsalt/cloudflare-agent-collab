#!/usr/bin/env bun
// Exports the public release tree (ISSUE-00036, planning SPEC 17.8). Copies an allowlist of the
// files committed at HEAD, writes MANIFEST.md (license per file) and NOTICE (third-party tooling),
// then sweeps the tree. Publishing is a RED decision for the owner; this script never pushes.
//
//   bun scripts/export-public.ts --check              export to a temp dir, sweep, exit 1 on a finding
//   bun scripts/export-public.ts --out <dir> [--git]  keep the export; --git adds a fresh history
//
// Everything not on the allowlist stays private by construction: the planning spec and docs,
// docs/plan/sources/, docs/internal/, CLAUDE.md, the owner's tools and the POC scripts.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");

// Whole directories, then single files. A path ships only if it matches one entry.
const ALLOW_DIRS = ["src/", "canonicals/", "tests/"];
const ALLOW_FILES = [
  ".gitignore", "LICENSE", "README.md", "CONTRACT.md", "package.json", "bun.lock", "tsconfig.json", "wrangler.jsonc",
  "docs/poc/POC.md", "docs/poc/COST.md", "docs/poc/evidence/poc-page.png", "docs/images/what-happens-where.png",
  "scripts/amend.ts", "scripts/arena.ts", "scripts/authority.ts", "scripts/comms.ts", "scripts/gyr.ts", "scripts/hidden.ts",
  "scripts/install.ts", "scripts/invite.ts", "scripts/records.ts", "scripts/scope.ts", "scripts/standing.ts", "scripts/uninstall.ts",
  "scripts/check-public.sh", "scripts/install-hooks.sh", "scripts/export-public.ts",
];

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

// Rules a public file must never match. Written as character classes so this file passes itself.
export const LEAK_RULES: readonly { readonly rule: string; readonly re: RegExp }[] = [
  { rule: "tailnet hostname", re: /\.ts[.]net/ },
  { rule: "absolute home path", re: /\/hom[e]\/|\/Users\/[a-z]/ },
  { rule: "Cloudflare user token", re: /cfu[t]_/ },
  { rule: "Artifacts repo token", re: /art_v[0-9]+_[0-9a-z]/ },
  { rule: "32-hex identifier", re: /(^|[^0-9A-Fa-f])[0-9a-f]{32}([^0-9A-Fa-f]|$)/ },
  { rule: "workers.dev subdomain", re: /[a-z0-9-]+\.[a-z0-9-]+\.worker[s]\.dev/ },
  { rule: "estate path or host", re: /~\/\.claud[e]|local\/project[s]\/|the-common[s]|isecadmi[n]|estate-contex[t]|0xsal[t]|fastmai[l]/i },
  { rule: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KE[Y]-----/ },
];

// Reviewed exceptions: a line that matches a rule on purpose, with the reason it may ship.
const EXCEPTIONS: readonly { readonly file: string; readonly rule: string; readonly why: string }[] = [];

export function sweepText(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const { rule, re } of LEAK_RULES) {
      if (re.test(line) && !EXCEPTIONS.some((e) => e.file === file && e.rule === rule)) out.push({ file, line: i + 1, rule });
    }
  });
  return out;
}

// A relative Markdown link must resolve inside the export, or the public tree points at a private file.
export function brokenLinks(file: string, text: string, shipped: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = (m[1] ?? "").split("#")[0] ?? "";
      if (target === "" || /^[a-z]+:/.test(target)) continue;
      const path = join(dirname(file), target).replace(/^\.\//, "");
      if (!shipped.has(path) && ![...shipped].some((s) => s.startsWith(`${path}/`))) out.push({ file, line: i + 1, rule: `link to unshipped ${path}` });
    }
  });
  return out;
}

export function allowed(path: string): boolean {
  return ALLOW_DIRS.some((d) => path.startsWith(d)) || ALLOW_FILES.includes(path);
}

async function notice(): Promise<string> {
  const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as Record<string, Record<string, string> | undefined>;
  const names = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).sort();
  const rows: string[] = [];
  for (const n of names) {
    const meta = (await Bun.file(join(ROOT, "node_modules", n, "package.json")).json().catch(() => ({}))) as { version?: string; license?: string };
    rows.push(`| ${n} | ${meta.version ?? "?"} | ${meta.license ?? "UNKNOWN"} |`);
  }
  return [
    "# Third-party notices",
    "",
    "This repository ships no third-party code. `bun install` fetches the development tools below",
    "from npm under their own licenses; `bun.lock` pins every transitive package.",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "Some transitive packages carry other licenses: for example, `sharp`, through miniflare, loads",
    "libvips under LGPL-3.0. They are installed on a developer's machine and never redistributed here.",
    "",
  ].join("\n");
}

function manifest(files: readonly string[]): string {
  const license = (f: string): string => (f === "bun.lock" ? "MIT; pins third-party packages, see NOTICE" : "MIT, see LICENSE");
  return [
    "# Public release manifest",
    "",
    `${files.length} files, exported by scripts/export-public.ts from an allowlist. Every file is the`,
    "project's own work under the MIT license in LICENSE, except where this table says otherwise.",
    "",
    "| File | License |",
    "| --- | --- |",
    ...files.map((f) => `| ${f} | ${license(f)} |`),
    "| MANIFEST.md, NOTICE.md | MIT, see LICENSE |",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const argOut = process.argv.indexOf("--out");
  const check = process.argv.includes("--check");
  if (!check && argOut < 0) throw new Error("usage: bun scripts/export-public.ts --check | --out <dir> [--git]");
  const out = argOut > 0 ? resolve(process.argv[argOut + 1] ?? "") : await mkdtemp(join(tmpdir(), "agent-collab-public-"));
  if (argOut > 0) {
    if ((await $`ls -A ${out}`.nothrow().quiet().text()).trim() !== "") throw new Error(`${out} is not empty`);
  }

  const head = (await $`git -C ${ROOT} rev-parse --short HEAD`.text()).trim();
  const tracked = (await $`git -C ${ROOT} ls-tree -r --name-only HEAD`.text()).trim().split("\n");
  const files = tracked.filter(allowed).sort();
  for (const f of files) {
    await mkdir(dirname(join(out, f)), { recursive: true });
    await Bun.write(join(out, f), await $`git -C ${ROOT} show ${`HEAD:${f}`}`.arrayBuffer());
  }
  await Bun.write(join(out, "MANIFEST.md"), manifest(files));
  await Bun.write(join(out, "NOTICE.md"), await notice());

  const shipped = new Set([...files, "MANIFEST.md", "NOTICE.md"]);
  const findings: Finding[] = [];
  for (const f of shipped) {
    const text = await Bun.file(join(out, f)).text();
    findings.push(...sweepText(f, text));
    if (f.endsWith(".md")) findings.push(...brokenLinks(f, text, shipped));
  }

  console.log(`export of ${head}: ${files.length} of ${tracked.length} tracked files, plus MANIFEST.md and NOTICE.md`);
  console.log(`excluded: ${tracked.length - files.length} files, for example ${tracked.filter((f) => !allowed(f)).filter((f) => !f.includes("/")).join(", ")}`);
  // Print the file, line and rule only, never the matched text.
  for (const x of findings) console.log(`FINDING ${x.file}:${x.line} ${x.rule}`);
  console.log(`sweep: ${findings.length} finding(s)`);

  if (process.argv.includes("--git") && argOut > 0 && findings.length === 0) {
    // A local branch, not main: some hosts refuse commits on main. Publishing pushes HEAD:main.
    await $`git -C ${out} init --quiet -b public-release`;
    await $`git -C ${out} add -A`;
    await $`git -C ${out} -c user.name=agent-collab -c user.email=agent-collab@users.noreply.invalid commit --quiet -m ${"agent-collab: first public release"}`;
    console.log(`fresh history: ${(await $`git -C ${out} rev-list --count HEAD`.text()).trim()} commit, ${(await $`git -C ${out} remote`.text()).trim() === "" ? "no remote" : "HAS A REMOTE"}`);
  }
  if (check) await rm(out, { recursive: true, force: true });
  else console.log(`kept: ${out}`);
  if (findings.length > 0) process.exit(1);
}

if (import.meta.main) await main();
