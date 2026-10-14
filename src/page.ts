// Live arena board. Polls /api/state every 2 seconds and /api/asks every 10 seconds. Renders with
// textContent only, so repo names, notes and reasons cannot inject HTML.
//
// The board tells the story in order (planning SPEC 13.5): one hero line, the human-attention
// slot, who is doing what, what just happened, the outcome so far and the runs, then the
// candidates, the rulings and the repositories. Panel titles are findings in words; every number
// sits against a total; unknown is a word, never a zero. Times are local, with an age.
//
// The attention slot is the red control (ISSUE-00021, planning SPEC 16.6): it counts the open red
// Decision Records, and a click opens each as a six-part brief (ask, recommend, basis, options,
// consequence, control) whose nine buttons post to the control route with fetch. The board is not a
// product view, so it may use fetch and buttons; every string still goes through textContent.
//
// The feed tells a run's story (ISSUE-00023): each verdict is one row, with the authority's
// plumbing (canonical main, notes and tag pushes, the admission note) folded under it. Probe
// traffic is labelled PROBE and never names the hero's last run or the Runs headline.
//
// The NEXT FORGE PROMPT panel reads the forge runs from the spec canonical's RUNS.md through
// /api/runs every 10 seconds (ISSUE-00027), so a run edit is one spec publish.
export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-collab arena</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; color: #9ecbff; }
  .hero { font-size: 18px; font-weight: 600; margin: 12px 0 6px; }
  .attn { display: inline-block; font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 4px; background: #1a1d24; border: 1px solid #262a33; color: #8b949e; cursor: pointer; }
  .attn.red { background: #3b0d0d; border-color: #f87171; color: #fca5a5; font-weight: 600; }
  #decisions-panel { margin: 10px 0 14px; display: grid; gap: 10px; }
  #decisions-panel[hidden] { display: none; }
  .brief { border-color: #f87171; }
  .brief .bp { display: grid; grid-template-columns: 96px 1fr; gap: 8px; margin: 6px 0; }
  .brief .bl { color: #8b949e; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; padding-top: 2px; }
  .brief .bs { font-weight: 600; }
  .brief ul { margin: 4px 0 0; padding-left: 18px; }
  .brief .controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .brief .controls button { font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 4px; border: 1px solid #3a4150; background: #1a1d24; color: #e6e6e6; cursor: pointer; }
  .brief .controls button:disabled { opacity: 0.5; cursor: wait; }
  .brief .controls button.response { color: #c9d1d9; border-style: dashed; }
  .brief .controls button.primary { background: #1f3b2a; border-color: #4ade80; color: #bbf7d0; font-weight: 600; }
  .brief input, .brief select { font: inherit; font-size: 12px; background: #0f1115; color: #e6e6e6; border: 1px solid #3a4150; border-radius: 4px; padding: 3px 6px; }
  .brief input.note { width: 100%; margin-top: 6px; box-sizing: border-box; }
  .brief .msg { color: #fca5a5; margin-top: 4px; }
  .label { font-size: 12px; padding: 8px 12px; background: #1a1d24; border-left: 3px solid #f6821f; margin: 12px 0; }
  .label b { color: #f6821f; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #262a33; vertical-align: top; }
  th { color: #8b949e; font-weight: 600; }
  td.age, th.age { text-align: right; color: #8b949e; white-space: nowrap; }
  td.time { white-space: nowrap; font-variant-numeric: tabular-nums; }
  code { font-family: ui-monospace, monospace; font-size: 12px; }
  .muted { color: #8b949e; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .spec ol { margin: 0; padding-left: 0; list-style: none; }
  .spec li { padding: 2px 0; border-bottom: 1px solid #1e222a; }
  .spec li.built { color: #4ade80; }
  .spec li.admitted { color: #9ecbff; }
  .spec li.open { color: #e6e6e6; }
  .spec .lbl { display: inline-block; width: 64px; font-size: 11px; font-weight: 600; }
  .spec .HIGH { color: #f87171; } .spec .MEDIUM { color: #fbbf24; } .spec .LOW { color: #8b949e; }
  .ADMIT { color: #4ade80; font-weight: 600; }
  .REFUSE { color: #f87171; font-weight: 600; }
  .SEND_BACK { color: #fbbf24; font-weight: 600; }
  .state { font-weight: 600; white-space: nowrap; }
  .state.building, .state.claiming { color: #9ecbff; }
  .state.awaiting-verdict, .state.ruling { color: #fbbf24; }
  .state.idle { color: #8b949e; }
  .chip { display: inline-block; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 3px; background: #262a33; white-space: nowrap; }
  .chip.probe { background: #2e1f47; color: #c4a7ff; }
  .fold summary { font-size: 12px; } .fold ul { margin: 4px 0 0; padding-left: 18px; color: #8b949e; font-size: 12px; }
  .parts b { font-weight: 600; } .parts .muted { margin-left: 6px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
  .card { background: #161a21; border: 1px solid #262a33; border-radius: 6px; padding: 10px 12px; }
  .card .t { font-weight: 600; margin-bottom: 4px; }
  details { margin-top: 6px; } summary { color: #9ecbff; cursor: pointer; }
  .empty { color: #8b949e; font-style: italic; padding: 4px 8px; }
  .map { margin: 14px 0 18px; }
  .next-prompt { margin: 10px 0; padding: 8px 12px; background: #161a21; border: 1px solid #262a33; border-left: 3px solid #c084fc; border-radius: 4px; }
  .np-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .np-standing { margin: 8px 0 6px; font-size: 15px; } .np-standing b { color: #e9d5ff; }
  .np-label { font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #c084fc; }
  #np-status { font-weight: 600; }
  .pa { margin: 10px 0; font-weight: 600; }
  .pa.running { color: #9ecbff; } .pa.paused { color: #f87171; } .pa.none { color: #8b949e; }
  #np-status.waiting { color: #fbbf24; } #np-status.running { color: #9ecbff; } #np-status.idle { color: #f87171; } #np-status.nothing { color: #8b949e; }
  #np-copy { margin-left: auto; font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 4px; border: 1px solid #3a4150; background: #1a1d24; color: #e6e6e6; cursor: pointer; }
  #np-text { margin: 8px 0 0; max-height: 170px; overflow: auto; white-space: pre-wrap; font: 12px/1.45 ui-monospace, monospace; color: #c9d1d9; background: #0f1115; padding: 8px; border-radius: 4px; }
  #np-text:empty { display: none; }
  .map-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .map-count { font-size: 22px; font-weight: 700; }
  .bar { flex: 1 1 320px; height: 14px; background: #262a33; border-radius: 7px; overflow: hidden; display: flex; }
  .bar-built { background: #22c55e; height: 100%; transition: width 0.6s; }
  .bar-admitted { background: #15803d; height: 100%; transition: width 0.6s; }
  .key { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 4px; font-size: 12px; color: #8b949e; }
  .key span::before { content: ""; display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: var(--c); }
  .group-title { font-size: 12px; font-weight: 700; letter-spacing: 0.05em; color: #8b949e; margin: 12px 0 6px; text-transform: uppercase; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  .tile { border-radius: 6px; padding: 8px 10px; background: var(--c); color: #0f1115; min-height: 72px; transition: background 0.6s; }
  .tile.dark { color: #e6e6e6; }
  .tile .tid { font-weight: 700; font-size: 13px; }
  .tile .tst { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin: 2px 0 4px; }
  .tile .tmeta { font-size: 11px; opacity: 0.9; }
  .tile.checking { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { filter: brightness(1.35); } }
  .comms { margin: 14px 0; }
  .comms .msgs { display: grid; gap: 6px; }
  .msg { border: 1px solid #262a33; border-left: 4px solid #60a5fa; border-radius: 4px; padding: 6px 10px; background: #14171d; }
  .msg.owner { border-left-color: #a78bfa; }
  .msg .mh { font-size: 12px; color: #8b949e; }
  .msg .mh b { color: #e6e6e6; }
  .msg .mf { font-weight: 600; margin: 2px 0; }
  .msg pre { white-space: pre-wrap; margin: 4px 0 0; font: 12px/1.4 ui-monospace, monospace; color: #c9d1d9; }
  .chip.green { background: #14532d; color: #bbf7d0; } .chip.yellow { background: #713f12; color: #fef08a; } .chip.red { background: #7f1d1d; color: #fecaca; }
</style>
</head>
<body>
<h1>agent-collab arena</h1>
<div class="muted"><span id="live-mode">Live view: polling, state every 2 seconds, asks every 10 seconds.</span> <span id="updated"></span></div>
<section class="map" aria-label="Spec map">
  <div class="map-head">
    <div class="map-count" id="map-count">reading the spec</div>
    <div class="bar" aria-hidden="true"><div class="bar-built" id="bar-built"></div><div class="bar-admitted" id="bar-admitted"></div></div>
    <button class="attn" id="attn" type="button" aria-expanded="false" aria-controls="decisions-panel">0 decisions need a human</button>
  </div>
  <div class="muted" id="gyr-count">GYR classifier: reading the decisions</div>
  <div id="decisions-panel" hidden></div>
  <div id="pa-status" class="pa none">reading the authority</div>
  <div class="next-prompt">
    <div class="np-head"><span class="np-label">Next forge prompt</span> <span id="np-status">reading the runs</span> <button type="button" id="np-copy">Copy the standing prompt</button></div>
    <div class="np-standing">The prompt to give the forge, every time: <b id="np-standing">Follow BOOTSTRAP.md on the arena.</b></div>
    <div class="muted">The next run, for reading. The forge reads it from RUNS.md itself:</div>
    <pre id="np-text"></pre>
  </div>
  <div class="key" id="map-key"></div>
  <div id="map-groups"></div>
</section>
<section class="comms" aria-label="Comms">
  <h2 id="comms-title">Comms: reading the channel</h2>
  <div class="msgs" id="comms-list"></div>
  <div class="empty" id="comms-empty">no message yet: the forge writes forge-to-owner, the owner answers on owner-to-forge</div>
</section>
<div class="hero" id="hero">reading the arena</div>
<div class="label"><b>Platform</b>: this control Worker, its Durable Object and the Queue. <b>Product</b>: the canonicals site, api and spec in the arena namespace, changed only by admitted candidates. Every row below derives from an event, a repo name or a verdict.</div>

<h2 id="roster-title">Who is doing what</h2>
<table><thead><tr><th>Actor</th><th>State</th><th>Last action</th><th>Candidates</th><th class="age">Age</th></tr></thead><tbody id="roster"></tbody></table>
<div class="empty" id="roster-empty">no actor has appeared yet</div>

<h2 id="feed-title">Just happened</h2>
<table><thead><tr><th>When</th><th>Actor</th><th>Kind</th><th>What</th><th class="age">Age</th></tr></thead><tbody id="feed"></tbody></table>
<div class="empty" id="feed-empty">no events yet</div>
<details id="feed-more" style="display:none"><summary id="feed-more-summary">Show all</summary><table><tbody id="feed-rest"></tbody></table></details>

<div class="grid">
<div>
<h2 id="spec-title">Outcome so far</h2>
<div class="muted" style="font-size:12px;margin-bottom:6px">[x] admitted and deployed &middot; [~] admitted, not deployed &middot; [ ] open. Label: the owner's confidence the ask is wanted.</div>
<div class="spec"><ol id="spec"></ol><div class="empty" id="spec-empty">spec canonical not seeded yet</div></div>
</div>
<div>
<h2 id="runs-title">Runs</h2>
<div class="cards" id="runs"></div>
<div class="empty" id="runs-empty">no run yet</div>
</div>
</div>

<h2 id="candidates-title">Candidates</h2>
<table><thead><tr><th>Ask</th><th>From</th><th>Head</th><th>Pushes</th><th>Latest ruling</th><th class="age">Age</th></tr></thead><tbody id="candidates"></tbody></table>
<div class="empty" id="candidates-empty">no candidates yet</div>

<h2 id="verdicts-title">Admission</h2>
<table><thead><tr><th>When</th><th>Candidate</th><th>Verdict</th><th>Reason</th><th>Merge / tag</th><th class="age">Age</th></tr></thead><tbody id="verdicts"></tbody></table>
<div class="empty" id="verdicts-empty">no rulings yet</div>

<h2 id="repos-title">Repositories</h2>
<table><thead><tr><th>Repo</th><th>Role</th><th>Parent</th><th>Created</th><th class="age">Age</th></tr></thead><tbody id="repos"></tbody></table>
<script>
let PROMPTS = [];
// ---- rendering helpers: textContent only
function cell(td, c) {
  if (c && typeof c === "object" && "code" in c) { const k = document.createElement("code"); k.textContent = c.code; td.appendChild(k); return; }
  // A chip is an inline-block span inside the cell; on the td itself it breaks the table's columns.
  if (c && typeof c === "object" && "cls" in c && /(^| )chip( |$)/.test(c.cls)) { const s = document.createElement("span"); s.className = c.cls; s.textContent = c.text; td.appendChild(s); return; }
  if (c && typeof c === "object" && "cls" in c) { td.textContent = c.text; td.className = c.cls; if (c.title) td.title = c.title; return; }
  if (c && typeof c === "object" && "parts" in c) { renderParts(td, c.parts); return; }
  if (c && typeof c === "object" && "fold" in c) { renderFold(td, c.text, c.fold); return; }
  td.textContent = c == null ? "" : String(c);
}
function row(tbody, cells, title) {
  const tr = document.createElement("tr");
  if (title) tr.title = title;
  for (const c of cells) { const td = document.createElement("td"); cell(td, c); tr.appendChild(td); }
  tbody.appendChild(tr);
}
function fill(id, rows, map, titleOf) {
  const tbody = document.getElementById(id);
  tbody.replaceChildren();
  for (const r of rows) row(tbody, map(r), titleOf ? titleOf(r) : "");
  const empty = document.getElementById(id + "-empty");
  if (empty) empty.style.display = rows.length ? "none" : "block";
}
function setText(id, text) { document.getElementById(id).textContent = text; }
const short = (h) => ({ code: (h || "").slice(0, 10) });
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
const IDLE_AFTER = 60 * 60 * 1000;

// ---- time: local, with an age
let NOW = Date.now();
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "unknown";
  const today = new Date(NOW);
  const sameDay = d.toDateString() === today.toDateString();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return sameDay ? t : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + t;
}
function ageOf(iso) {
  const s = Math.max(0, Math.round((NOW - Date.parse(iso)) / 1000));
  if (isNaN(s)) return "unknown";
  if (s < 60) return s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  if (h < 48) return h + " h " + (m % 60) + " min";
  return Math.floor(h / 24) + " d";
}
// The end of a range: its time alone on the start's day, else with its date. (Splitting fmtTime on a
// space kept only "PM" in 12-hour locales.)
function endTime(startIso, endIso) {
  const s = new Date(startIso), e = new Date(endIso);
  if (isNaN(e)) return "unknown";
  return s.toDateString() === e.toDateString() ? e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : e.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
const age = (iso) => ({ cls: "age", text: ageOf(iso) + " ago" });
const when = (iso) => ({ cls: "time", text: fmtTime(iso) });

// ---- candidate names as parts; the hash sits behind a hover
function parseCand(name) {
  const p = (name || "").split("--");
  if (p.length !== 6 || p[0] !== "cand") return null;
  return { objective: p[1], world: p[2], harness: p[3], agent: p[4], session: p[5] };
}
function renderParts(td, name) {
  const c = parseCand(name);
  td.className = "parts";
  td.title = name;
  if (!c) { td.textContent = name; return; }
  const b = document.createElement("b"); b.textContent = c.objective;
  const m = document.createElement("span"); m.className = "muted"; m.textContent = c.world + "/" + c.harness + " slot " + c.agent;
  td.append(b, m);
}
function renderFold(td, text, fold) {
  td.textContent = text;
  if (!fold.length) return;
  const d = document.createElement("details"); d.className = "fold";
  const s = document.createElement("summary"); s.textContent = plural(fold.length, "authority step") + " folded in";
  const ul = document.createElement("ul");
  for (const e of fold) { const li = document.createElement("li"); li.textContent = fmtTime(e.at) + " " + lineOf(e); ul.appendChild(li); }
  d.append(s, ul); td.appendChild(d);
}
function partsText(name) {
  const c = parseCand(name);
  return c ? c.objective + " slot " + c.agent : name;
}

// ---- events, actors and lines (the same rules as the product's series-now and series-feed)
const KIND_ORDER = { claim: 0, fork: 1, push: 2, verdict: 3, decision: 4, comms: 5 };
const byTime = (a, b) => Date.parse(a.at) - Date.parse(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);
// ---- probes: the owner's probe scripts claim with harness "probe". Before 2026-10-08 they claimed
// as commons/script with the fixed slots p1 (probe-candidate.ts) and r1 (reserved-path.sh); the
// arena.ts slice used a1 to a3 and stays a builder. Probe events act as world/probe.
const LEGACY_PROBE_SLOTS = ["p1", "r1"];
function isProbeCand(c) { return !!c && (c.harness === "probe" || (c.world === "commons" && c.harness === "script" && LEGACY_PROBE_SLOTS.includes(c.agent))); }
function isProbeActor(actor) { return /\\/probe$/.test(actor || ""); }
function eventsOf(s) {
  const out = [];
  const probeClaims = new Set();
  for (const r of s.repos || []) { const n = parseCand(r.name); if (r.role === "candidate" && isProbeCand(n)) probeClaims.add(n.world + "/" + n.harness + "/" + n.session); }
  for (const c of s.arenaClaims || []) out.push({ kind: "claim", subject: "claim-" + c.id, at: c.claimed_at, canonical: c.canonical, objective: c.objective, slots: c.slots, claimed_by: c.claimed_by, probe: (c.claimed_by || "").split("/")[1] === "probe" || probeClaims.has(c.claimed_by) });
  for (const r of s.repos || []) if (r.role === "candidate") { const n = parseCand(r.name) || {}; out.push({ kind: "fork", subject: r.name, at: r.created_at, canonical: r.parent, objective: n.objective, world: n.world, harness: n.harness, agent: n.agent, session: n.session, probe: isProbeCand(n) }); }
  // A comms push is a message; the COMMS panel and commsEvents show it, not the arena rows.
  for (const e of s.events || []) if (e.type === "cf.artifacts.repo.pushed" && !COMMS_REPOS.includes(e.repo)) out.push({ kind: "push", subject: e.repo, at: e.received_at, ref: e.ref, commit: e.after, message: e.message, author: e.author, probe: isProbeCand(parseCand(e.repo)) });
  for (const v of s.verdicts || []) out.push({ kind: "verdict", subject: v.candidate, at: v.ruled_at, verdict: v.verdict, reason: v.reason, objective: v.objective, canonical: v.canonical, probe: isProbeCand(parseCand(v.candidate)) });
  out.sort(byTime);
  return out;
}
// Yellow rows are one feed line; a decided red row shows its action, actor and time; green rows and
// open red rows (the attention slot has those) do not render here.
function decisionEvents(s) {
  const out = [];
  for (const d of s.decisions || []) {
    const summary = d.record && d.record.decision_requested ? d.record.decision_requested.summary : d.kind;
    // A routed row (ISSUE-00029) is one feed line, green or yellow, with the classifier's reason.
    if (d.kind === "routed_green" || d.kind === "routed_yellow") out.push({ kind: "decision", subject: d.subject, at: d.opened_at, id: d.id, cls: d.class, gyr: true, summary: summary + " " + d.record.why_now.summary });
    else if (d.class === "yellow") out.push({ kind: "decision", subject: d.subject, at: d.opened_at, id: d.id, cls: "yellow", summary: summary });
    else if (d.class === "red" && d.status === "decided") out.push({ kind: "decision", subject: d.subject, at: d.decided_at, id: d.id, cls: "red", summary: summary, action: d.action, choice: d.choice, actor: d.actor });
  }
  return out;
}
// One feed row per comms message, from the last /api/comms read.
const COMMS_REPOS = ["forge-to-owner", "owner-to-forge"];
let commsMessages = [];
function commsEvents() {
  return commsMessages.map((m) => ({ kind: "comms", subject: m.path, at: m.at, from: m.from, to: m.to, re: m.re, mkind: m.kind, cls: m.class, first: m.body.split("\\n").find((l) => l.trim()) || "" }));
}
function actorOf(e) {
  if (e.kind === "comms") return e.from;
  if (e.kind === "decision" && e.cls === "red") return e.actor || "human";
  const harness = (h) => (e.probe ? "probe" : h);
  if (e.kind === "claim") { const p = (e.claimed_by || "").split("/"); return p[0] + "/" + harness(p[1]); }
  if (e.kind === "fork") return e.world + "/" + harness(e.harness);
  if (e.kind === "push") { const c = parseCand(e.subject); if (c && (e.ref === "refs/heads/main" || e.ref === "refs/notes/commits")) return c.world + "/" + harness(c.harness); }
  return "authority";
}
// One feed row per verdict, per submission and per probe:
// - each authority push folds under the verdict nearest in time within 30 s on either side, when it
//   touches that verdict's candidate or, for an ADMIT, its canonical (the plumbing lands up to about
//   12 s before the verdict is recorded, so the window looks both ways);
// - a candidate's checks note (refs/notes/commits) folds under its main push within 30 s;
// - a probe's claim, fork and pushes fold under that probe session's next verdict.
const FOLD_MS = 30 * 1000;
function sessionOf(e) {
  if (e.kind === "claim") return e.claimed_by || "";
  const c = parseCand(e.subject);
  return c ? c.world + "/" + c.harness + "/" + c.session : "";
}
function nearest(list, e, owns) {
  const t = Date.parse(e.at);
  let best = null, bestGap = Infinity;
  for (const p of list) {
    if (!owns(p)) continue;
    const gap = Math.abs(Date.parse(p.at) - t);
    if (gap <= FOLD_MS && gap < bestGap) { best = p; bestGap = gap; }
  }
  return best;
}
function feedRows(events) {
  const verdicts = events.filter((e) => e.kind === "verdict");
  const mains = events.filter((e) => e.kind === "push" && e.ref === "refs/heads/main" && parseCand(e.subject));
  const parent = new Map();
  for (const e of events) {
    let p = null;
    if (e.kind === "push" && actorOf(e) === "authority") p = nearest(verdicts, e, (v) => e.subject === v.subject || (v.verdict === "ADMIT" && e.subject === v.canonical));
    else if (e.probe && e.kind !== "verdict") p = verdicts.find((v) => v.probe && Date.parse(v.at) >= Date.parse(e.at) && sessionOf(v) === sessionOf(e)) || null;
    else if (e.kind === "push" && e.ref === "refs/notes/commits") p = nearest(mains, e, (m) => m.subject === e.subject);
    if (p) parent.set(e, p);
  }
  const root = (e) => { while (parent.has(e)) e = parent.get(e); return e; };
  const folded = new Map();
  const out = [];
  for (const e of events) {
    if (!parent.has(e)) { out.push(e); continue; }
    const r = root(e);
    if (!folded.has(r)) folded.set(r, []);
    folded.get(r).push(e);
  }
  return out.map((e) => ({ e, fold: folded.get(e) || [] }));
}
function lineOf(e) {
  if (e.kind === "comms") return e.mkind + (e.cls ? " (" + e.cls + ")" : "") + " to " + e.to + " re " + e.re + ": " + e.first;
  if (e.kind === "decision") return e.gyr || e.cls === "yellow" ? e.summary : "decision " + e.id + ": " + e.action + (e.choice ? " (" + e.choice + ")" : "") + " by " + e.actor + " on " + e.summary;
  const c = parseCand(e.subject);
  const who = c ? c.objective + " slot " + c.agent : e.subject;
  if (e.kind === "claim") return "claimed " + plural(e.slots, "slot") + " on " + e.canonical + " for " + e.objective;
  if (e.kind === "fork") return "forked " + e.canonical + " for " + e.objective + ", slot " + e.agent;
  if (e.kind === "push") {
    const ref = e.ref || "", msg = e.message || "";
    if (c) {
      if (ref === "refs/heads/main") return "pushed " + who + (msg ? ": " + msg : "");
      if (ref === "refs/notes/commits") return "noted " + who;
      if (ref === "refs/notes/admission") return "admission note on " + who;
      return "pushed " + ref + " on " + who;
    }
    if (ref === "refs/heads/main") return e.subject + " main" + (msg ? ": " + msg : "");
    if (ref.startsWith("refs/tags/")) return e.subject + " tagged " + ref.slice(10);
    if (ref.startsWith("refs/notes/")) return e.subject + " notes updated";
    return e.subject + " " + ref;
  }
  return e.verdict + " " + who + ": " + e.reason;
}

// ---- the roster: one row per world/harness, then the authority
// One definition of a candidate and of "awaiting a ruling", shared by the roster and paState.
function candidatesOf(events) {
  const cands = new Map();
  for (const e of events) if (e.kind === "fork") cands.set(e.subject, { actor: actorOf(e), probe: !!e.probe, lastSubmit: null, verdict: null });
  for (const e of events) {
    const c = cands.get(e.subject); if (!c) continue;
    const t = Date.parse(e.at);
    if (e.kind === "push" && (e.ref === "refs/heads/main" || e.ref === "refs/notes/commits")) c.lastSubmit = t;
    if (e.kind === "verdict") c.verdict = { at: t, verdict: e.verdict };
  }
  return cands;
}
const awaiting = (c) => c.lastSubmit !== null && (c.verdict === null || c.lastSubmit > c.verdict.at);
// Whether the authority is running or paused, derived: there is no pause flag and no heartbeat.
// Running while its newest verdict or push is within IDLE_AFTER, paused after, none before its first.
function paState(events) {
  let last = null;
  for (const e of events) {
    if ((e.kind !== "verdict" && e.kind !== "push") || actorOf(e) !== "authority") continue;
    if (last === null || Date.parse(e.at) > Date.parse(last.at)) last = e;
  }
  const owed = [...candidatesOf(events).values()].filter(awaiting).length;
  if (last === null) return { state: "none", since: null, last: null, owed };
  const at = new Date(Date.parse(last.at)).toISOString();
  const paused = NOW - Date.parse(last.at) > IDLE_AFTER;
  return { state: paused ? "paused" : "running", since: paused ? at : null, last: at, owed };
}
function roster(events) {
  const cands = candidatesOf(events);
  // A probe never resubmits, so any verdict ends it; a builder's SEND_BACK leaves its candidate open.
  const isOpen = (c) => c.verdict === null || (c.verdict.verdict === "SEND_BACK" && !c.probe);
  const actors = new Map();
  const touch = (name, e) => { const a = actors.get(name) || { last: null, slots: 0, forks: 0 }; a.last = e; actors.set(name, a); return a; };
  for (const e of events) {
    const name = actorOf(e);
    const c = parseCand(e.subject);
    if (name === "authority") { touch(name, e); if (e.kind === "verdict" && c) touch(c.world + "/" + (e.probe ? "probe" : c.harness), e); continue; }
    const a = touch(name, e);
    if (e.kind === "claim") a.slots += Number(e.slots) || 0;
    if (e.kind === "fork") a.forks += 1;
  }
  const rows = [];
  for (const [actor, a] of actors) {
    const since = Date.parse(a.last.at);
    const mine = [...cands.values()].filter((c) => actor === "authority" || c.actor === actor);
    const owed = mine.filter(awaiting).length;
    let state;
    if (actor === "authority") state = mine.some((c) => awaiting(c) && NOW - c.lastSubmit <= IDLE_AFTER) ? "ruling" : "idle";
    else if (NOW - since > IDLE_AFTER) state = "idle";
    else if (a.slots > a.forks) state = "claiming";
    else if (owed > 0) state = "awaiting-verdict";
    else if (mine.some(isOpen)) state = "building";
    else state = "idle";
    rows.push({ actor, state, since: a.last.at, line: lineOf(a.last), open: mine.filter(isOpen).length, owed });
  }
  rows.sort((x, y) => (x.actor === "authority") - (y.actor === "authority") || (x.actor < y.actor ? -1 : x.actor > y.actor ? 1 : 0));
  return rows;
}

// ---- runs: a burst of claims from one actor, 15 minutes of gap starts a new one
function runsOf(events) {
  const claimsBy = new Map();
  for (const e of events) if (e.kind === "claim") { const a = actorOf(e); const l = claimsBy.get(a) || []; l.push({ at: e.at, t: Date.parse(e.at), key: e.objective + "\\u0000" + e.claimed_by, slots: Number(e.slots) || 0 }); claimsBy.set(a, l); }
  const cands = new Map();
  for (const e of events) if (e.kind === "fork") cands.set(e.subject, { key: e.objective + "\\u0000" + e.world + "/" + e.harness + "/" + e.session, firstMain: null, firstAdmit: null, verdict: null, last: Date.parse(e.at) });
  for (const e of events) {
    const c = cands.get(e.subject); if (!c) continue;
    const t = Date.parse(e.at); c.last = Math.max(c.last, t);
    if (e.kind === "push" && e.ref === "refs/heads/main" && c.firstMain === null) c.firstMain = t;
    if (e.kind === "verdict") { c.verdict = e.verdict; if (e.verdict === "ADMIT" && c.firstAdmit === null) c.firstAdmit = t; }
  }
  const runs = [];
  for (const [actor, claims] of claimsBy) {
    let burst = [];
    const flush = () => {
      if (!burst.length) return;
      const keys = new Set(burst.map((c) => c.key));
      const mine = [...cands.values()].filter((c) => keys.has(c.key));
      const count = (v) => mine.filter((c) => c.verdict === v).length;
      const secs = mine.filter((c) => c.firstMain !== null && c.firstAdmit !== null).map((c) => Math.round((c.firstAdmit - c.firstMain) / 1000)).sort((a, b) => a - b);
      const ended = Math.max(...burst.map((c) => c.t), ...mine.map((c) => c.last));
      runs.push({ actor, started: burst[0].at, ended: new Date(ended).toISOString(), claims: burst.length, candidates: mine.length, admit: count("ADMIT"), refuse: count("REFUSE"), send_back: count("SEND_BACK"), owed: count(null), median: secs.length ? secs[Math.max(0, Math.ceil(0.5 * secs.length) - 1)] : null });
      burst = [];
    };
    for (const c of claims) { const prev = burst[burst.length - 1]; if (prev && c.t - prev.t > 15 * 60 * 1000) flush(); burst.push(c); }
    flush();
  }
  runs.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0));
  return runs;
}
function runSummary(r) {
  const v = [];
  if (r.admit) v.push(r.admit + " ADMIT"); if (r.refuse) v.push(r.refuse + " REFUSE"); if (r.send_back) v.push(r.send_back + " SEND_BACK"); if (r.owed) v.push(r.owed + " awaiting a verdict");
  const mins = Math.max(0, Math.round((Date.parse(r.ended) - Date.parse(r.started)) / 60000));
  return plural(r.claims, "claim") + ", " + (v.length ? v.join(", ") : "no verdict yet") + " in " + plural(mins, "min", "min") + (r.median === null ? "" : ", median " + r.median + " s to admit");
}

// ---- the spec map: one tile per ask, its live state from events (probe traffic never colours one)
const TILE_STATES = ["open", "claimed", "forked", "submitted", "checking", "owner", "sent back", "refused", "admitted", "deployed"];
const TILE_LABEL = { open: "open", claimed: "claimed", forked: "forked", submitted: "submitted", checking: "being checked", owner: "owner decides", "sent back": "sent back", refused: "refused", admitted: "admitted", deployed: "deployed" };
// Among live candidates the most advanced wins; a refused one only shows when nothing else is live.
const TILE_RANK = { open: 0, claimed: 1, refused: 2, forked: 3, "sent back": 4, submitted: 5, checking: 6, owner: 7 };
function candState(c) {
  if (c.owner) return "owner";
  const lastSub = Math.max(c.main, c.note);
  if (c.verdict && c.verdict.t >= lastSub) return c.verdict.verdict === "SEND_BACK" ? "sent back" : c.verdict.verdict === "REFUSE" ? "refused" : "admitted";
  if (c.note > 0 && c.note >= c.main) return "checking";
  if (c.main > 0) return "submitted";
  return "forked";
}
// The spec amendments in flight (ISSUE-00015): one pseudo-ask per amend objective a builder claimed
// on spec, admitted once spec ADMITs it. Probe amendments never make a tile.
function amendAsks(events) {
  const out = new Map();
  for (const e of events) {
    if (e.probe || e.canonical !== "spec" || !(e.objective || "").startsWith("amend-")) continue;
    if (e.kind !== "claim" && e.kind !== "fork" && e.kind !== "verdict") continue;
    const a = out.get(e.objective) || { id: e.objective, canonical: "spec", label: "AMEND", admitted: false, built: false, tag: null, admitted_from: null };
    if (e.kind === "verdict" && e.verdict === "ADMIT") { a.admitted = true; a.admitted_from = e.subject; }
    out.set(e.objective, a);
  }
  return [...out.values()];
}
// waiting: candidate names with an open amendment decision; those wait for the owner.
function askTiles(asks, events, waiting) {
  const cands = new Map();
  for (const e of events) if (e.kind === "fork" && !e.probe) cands.set(e.subject, { objective: e.objective, canonical: e.canonical, who: e.world + "/" + e.harness + " " + e.agent, main: 0, note: 0, verdict: null, owner: !!waiting && waiting.has(e.subject) });
  const lastVerdict = new Map();
  const admits = new Map();
  for (const e of events) {
    if (e.kind === "verdict" && e.verdict === "ADMIT") admits.set(e.subject, e);
    if (e.probe) continue;
    const c = cands.get(e.subject);
    const t = Date.parse(e.at);
    if (c && e.kind === "push" && e.ref === "refs/heads/main") c.main = t;
    if (c && e.kind === "push" && e.ref === "refs/notes/commits") c.note = t;
    if (e.kind === "verdict") { if (c) c.verdict = { t, verdict: e.verdict }; lastVerdict.set(e.canonical + "/" + e.objective, e); }
  }
  const claimed = new Set(events.filter((e) => e.kind === "claim" && !e.probe).map((e) => e.canonical + "/" + e.objective));
  return asks.map((a) => {
    const mine = [...cands.values()].filter((c) => c.objective === a.id && c.canonical === a.canonical);
    let state = "open";
    if (a.built) state = "deployed";
    else if (a.admitted) state = "admitted";
    else {
      if (claimed.has(a.canonical + "/" + a.id)) state = "claimed";
      for (const c of mine) { const s = candState(c); if (s !== "admitted" && TILE_RANK[s] > TILE_RANK[state]) state = s; }
    }
    // A built ask names the candidate it was admitted from and that ADMIT, even when a probe built it.
    if (state === "deployed" || state === "admitted") {
      const from = parseCand(a.admitted_from);
      const who = from ? from.world + "/" + (isProbeCand(from) ? "probe" : from.harness) + " " + from.agent : null;
      return { id: a.id, canonical: a.canonical, label: a.label, tag: a.tag || null, state, agents: who ? [who] : [], forks: Math.max(mine.length, who ? 1 : 0), last: admits.get(a.admitted_from) || lastVerdict.get(a.canonical + "/" + a.id) || null };
    }
    const live = mine.filter((c) => candState(c) !== "refused");
    const agents = [...new Set(live.map((c) => c.who))];
    return { id: a.id, canonical: a.canonical, label: a.label, tag: a.tag || null, state, agents, forks: mine.length, last: lastVerdict.get(a.canonical + "/" + a.id) || null };
  });
}

// ---- the next forge prompt (src/prompts.ts): the first run not done, and whether it is running
const RUN_IDLE_MS = 30 * 60 * 1000;
function objectiveOf(e) {
  if (e.kind === "claim" || e.kind === "fork" || e.kind === "verdict") return e.objective;
  const c = parseCand(e.subject);
  return c ? c.objective : null;
}
// An objective ending in "*" matches any objective with that prefix (run 4a: "amend-*").
const objMatch = (o, x) => (o.endsWith("*") ? (x || "").startsWith(o.slice(0, -1)) : o === x);
function nextRun(prompts, asks, events) {
  const real = events.filter((e) => !e.probe);
  const admitted = new Set(asks.filter((a) => a.admitted).map((a) => a.id));
  const settled = new Map();
  for (const e of real) if (e.kind === "verdict") settled.set(e.objective, e.verdict === "ADMIT" || e.verdict === "REFUSE");
  for (const e of real) if (e.kind === "verdict" && e.verdict === "ADMIT" && e.canonical === "spec") admitted.add(e.objective);
  // A wildcard is done once every objective it claimed is settled by an ADMIT or a REFUSE.
  const claimedBy = (o) => [...new Set(real.filter((e) => e.kind === "claim" && objMatch(o, e.objective)).map((e) => e.objective))];
  const objDone = (o) => (o.endsWith("*") ? claimedBy(o).length > 0 && claimedBy(o).every((x) => admitted.has(x) || settled.get(x) === true) : admitted.has(o));
  for (const p of prompts) {
    if (p.done || p.objectives.every(objDone)) continue;
    const mine = real.filter((e) => p.objectives.some((o) => objMatch(o, objectiveOf(e))));
    const claims = mine.filter((e) => e.kind === "claim");
    if (claims.length === 0) return { prompt: p, status: "waiting", started: null, last: null };
    const started = claims[0].at;
    const last = mine[mine.length - 1].at;
    return { prompt: p, status: NOW - Date.parse(last) > RUN_IDLE_MS ? "idle" : "running", started, last };
  }
  return { prompt: null, status: "nothing", started: null, last: null };
}

// ---- the red control: open red Decision Records as six-part briefs
const CONTROLS = ["approve", "choose_alternative", "request_evidence", "challenge_assumption", "request_options", "modify_redirect", "defer", "reject", "stop"];
const CONTROL_LABEL = { approve: "Approve", choose_alternative: "Choose alternative", request_evidence: "Request evidence", challenge_assumption: "Challenge assumption", request_options: "Request options", modify_redirect: "Modify or redirect", defer: "Defer", reject: "Reject", stop: "Stop" };
let panelOpen = false;
let panelSig = null;
let panelAges = [];
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function bpart(label) { const p = el("div", "bp"); p.appendChild(el("span", "bl", label)); const body = el("div"); p.appendChild(body); p.body = body; return p; }
function details(title, nodes) {
  const d = document.createElement("details");
  d.appendChild(el("summary", null, title));
  for (const n of nodes) d.appendChild(n);
  return d;
}
function refList(refs) {
  const ul = document.createElement("ul");
  for (const r of refs || []) ul.appendChild(el("li", null, r));
  return ul;
}
function timeText(tc) {
  return "urgency " + tc.urgency + ", " + (tc.deferral_safe ? "safe to defer" : "not safe to defer") + (tc.needed_by ? ", needed by " + tc.needed_by : "");
}
function optionLine(o) { return o.name + ": " + o.summary; }
// Approve, reject and choose_alternative are what the outcome buttons do; they never appear twice.
const OUTCOME_CONTROLS = ["approve", "reject", "choose_alternative"];
// The outcome in words: the option's summary up to its first clause, else its name.
function outcomeLabel(o) {
  const s = (o.summary || "").split(/[;.]/)[0].trim();
  return s ? s : o.name;
}
function brief(d) {
  const r = d.record;
  const tc = r.time_control;
  const options = r.alternatives.options;
  const recommended = options.find((o) => o.name === r.recommendation.choice);
  const rival = options.find((o) => o.name !== r.recommendation.choice);
  const card = el("div", "card brief");
  card.title = d.subject;
  const head = el("div", "t", "#" + d.id + " " + d.kind.replace("_", " ") + " \\u00b7 " + partsText(d.subject) + " \\u00b7 opened ");
  const when = el("span");
  panelAges.push({ node: when, iso: d.opened_at });
  head.appendChild(when);
  card.appendChild(head);

  const ask = bpart("ASK");
  ask.body.append(el("div", "bs", r.decision_requested.summary), el("div", "muted", "Why now: " + r.why_now.summary + (r.why_now.red_criteria && r.why_now.red_criteria.length ? " [" + r.why_now.red_criteria.join(", ") + "]" : "")), el("div", "muted", "Time: " + timeText(tc)));
  const rec = bpart("RECOMMEND");
  rec.body.append(el("div", "bs", r.recommendation.choice), el("div", "muted", r.recommendation.summary));
  const basis = bpart("BASIS");
  basis.body.appendChild(el("div", null, r.evidence.summary));
  const evidence = [];
  if (r.evidence.detail) evidence.push(el("div", null, r.evidence.detail));
  if (r.evidence.refs && r.evidence.refs.length) evidence.push(refList(r.evidence.refs));
  evidence.push(el("div", null, "Assumes: " + r.assumptions.summary + (r.assumptions.detail ? " " + r.assumptions.detail : "")));
  evidence.push(el("div", null, "Uncertainty: " + r.uncertainty.summary + (r.uncertainty.confidence != null ? " (confidence " + r.uncertainty.confidence + " of 100)" : "")));
  basis.body.appendChild(details("Show evidence", evidence));
  const opts = bpart("OPTIONS");
  opts.body.appendChild(el("div", null, "Recommended - " + (recommended ? optionLine(recommended) : r.recommendation.choice)));
  if (rival) opts.body.appendChild(el("div", null, "Strongest competitor - " + optionLine(rival)));
  opts.body.appendChild(el("div", null, "Do nothing - " + r.no_action_baseline.summary));
  opts.body.appendChild(details("Compare", [el("div", "muted", r.alternatives.summary)].concat(options.map((o) => el("div", null, optionLine(o))), [el("div", null, "Do nothing: " + r.no_action_baseline.summary + (r.no_action_baseline.detail ? " " + r.no_action_baseline.detail : ""))])));
  const cons = bpart("CONSEQUENCE");
  cons.body.appendChild(el("div", null, "Blast radius: " + (r.blast_radius.level || "not rated") + " \\u00b7 Cost: " + r.cost_tradeoffs.summary + " \\u00b7 Reversal cost: " + r.reversibility.reversal_cost));
  cons.body.appendChild(details("Show impact", [el("div", null, "Blast radius: " + r.blast_radius.summary + (r.blast_radius.detail ? " " + r.blast_radius.detail : "")), el("div", null, "Cost: " + r.cost_tradeoffs.summary + (r.cost_tradeoffs.detail ? " " + r.cost_tradeoffs.detail : "")), el("div", null, "Reversibility: " + r.reversibility.summary + (r.reversibility.detail ? " " + r.reversibility.detail : ""))]));

  const control = bpart("CONTROL");
  const msg = el("div", "msg");
  const note = el("input", "note");
  note.type = "text"; note.maxLength = 500; note.placeholder = "Note (optional, at most 500 characters)";
  // One button per outcome, worded as the outcome, the recommended one first (Chris, 2026-10-08:
  // "Approve" on "Approve admitting X" read as approving the refusal). Each posts choose_alternative
  // with that option, so the buttons are the only path to an outcome; the other responses follow.
  const row = el("div", "controls");
  const ordered = [recommended].concat(options.filter((o) => o !== recommended)).filter(Boolean);
  for (const o of ordered) {
    const b = el("button", o === recommended ? "primary" : null, outcomeLabel(o) + (o === recommended ? " (recommended)" : ""));
    b.type = "button";
    b.title = o.summary;
    b.addEventListener("click", () => decide(d, "choose_alternative", o.name, note.value, card, msg));
    row.appendChild(b);
  }
  // Every response is a visible button (Chris, 2026-10-08): the outcomes first, then the six others.
  for (const a of (tc.controls && tc.controls.length ? tc.controls : CONTROLS).filter((x) => !OUTCOME_CONTROLS.includes(x))) {
    const b = el("button", "response", CONTROL_LABEL[a] || a);
    b.type = "button";
    b.addEventListener("click", () => decide(d, a, null, note.value, card, msg));
    row.appendChild(b);
  }
  control.body.append(row, note, msg);
  card.append(ask, rec, basis, opts, cons, control);
  return card;
}
async function decide(d, action, choice, note, card, msg) {
  const buttons = card.querySelectorAll("button");
  const body = { action: action };
  if (action === "choose_alternative") body.choice = choice;
  if (note) body.note = note;
  for (const b of buttons) b.disabled = true;
  msg.textContent = "";
  try {
    const res = await fetch("/api/arena/decisions/" + d.id + "/control", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { msg.textContent = "Not recorded: " + (j.error || "HTTP " + res.status); for (const b of buttons) b.disabled = false; return; }
    panelSig = null;
    await tick();
  } catch (err) {
    msg.textContent = "Not recorded: " + err;
    for (const b of buttons) b.disabled = false;
  }
}
function renderDecisions(s) {
  const open = (s.decisions || []).filter((d) => d.class === "red" && d.status === "open");
  const slot = document.getElementById("attn");
  slot.className = "attn" + (open.length ? " red" : "");
  slot.textContent = open.length + (open.length === 1 ? " decision needs" : " decisions need") + " a human";
  // ISSUE-00029: the GYR gate's tally. A routed row is a proposed red it sent back to the authority;
  // a red row with a "gyr: " ref is one it escalated.
  const all = s.decisions || [];
  const routed = all.filter((d) => d.kind === "routed_green" || d.kind === "routed_yellow").length;
  const escalated = all.filter((d) => d.class === "red" && ((d.record.evidence && d.record.evidence.refs) || []).some((x) => x.startsWith("gyr: "))).length;
  setText("gyr-count", "GYR classifier: " + plural(routed + escalated, "proposed red") + ", " + escalated + " escalated to a human, " + routed + " handled by the authority");
  const sig = open.map((d) => d.id).join(",");
  if (sig !== panelSig) {
    panelSig = sig;
    panelAges = [];
    const panel = document.getElementById("decisions-panel");
    panel.replaceChildren();
    if (open.length === 0) panel.appendChild(el("div", "empty", "No open decision. Green is recorded; yellow is one line in the feed."));
    for (const d of open) panel.appendChild(brief(d));
  }
  for (const a of panelAges) a.node.textContent = fmtTime(a.iso) + " (" + ageOf(a.iso) + " ago)";
}
document.getElementById("attn").addEventListener("click", () => {
  panelOpen = !panelOpen;
  document.getElementById("decisions-panel").hidden = !panelOpen;
  document.getElementById("attn").setAttribute("aria-expanded", String(panelOpen));
});

// ---- the spec map's rendering: a fixed colour key, one grid per canonical as SPEC section 8 lists
// them, and a header with the admitted count, a progress bar and the decision slot
const TILE_COLOUR = { open: "#2a2f3a", claimed: "#475a85", forked: "#2b6cb0", submitted: "#60a5fa", checking: "#f59e0b", owner: "#c084fc", "sent back": "#facc15", refused: "#ef4444", admitted: "#4ade80", deployed: "#16a34a" };
const DARK_TILES = ["open", "claimed", "forked", "deployed"];
const GROUP_TITLE = { api: "SPEC 8 · api: series", site: "SPEC 8 · site: views", spec: "Spec amendments: the GYR gate rules each, a red one waits for the owner" };
let asksList = null;
let npShown = null;
function renderPaStatus(events) {
  const pa = paState(events);
  const el = document.getElementById("pa-status");
  el.className = "pa " + pa.state;
  const n = plural(pa.owed, "candidate");
  el.textContent = pa.state === "running" ? "Authority running: last ruling " + ageOf(pa.last) + " ago; " + n + (pa.owed === 1 ? " awaits" : " await") + " a ruling"
    : pa.state === "paused" ? "Authority paused: no action since " + fmtTime(pa.since) + " (" + ageOf(pa.since) + "); " + n + (pa.owed === 1 ? " waits" : " wait") + " for it"
    : "Authority: no action yet; " + n + (pa.owed === 1 ? " waits" : " wait") + " for it";
}
function renderNextPrompt(events) {
  if (!asksList) return;
  const n = nextRun(PROMPTS, asksList, events);
  const status = document.getElementById("np-status");
  status.className = n.status;
  const name = n.prompt ? "run " + n.prompt.run : "";
  status.textContent = n.status === "waiting" ? "Next: the forge starts " + n.prompt.title + " from RUNS.md (standing prompt: Follow BOOTSTRAP.md on the arena)"
    : n.status === "running" ? "Running: " + name + ", started " + fmtTime(n.started) + ", last activity " + ageOf(n.last) + " ago"
    : n.status === "idle" ? "Idle: " + name + " started " + fmtTime(n.started) + ", no activity for " + ageOf(n.last) + "; this prompt is still the next one"
    : "Nothing to run: every prompt is done";
  const text = n.prompt ? n.prompt.prompt : "";
  if (text !== npShown) { npShown = text; setText("np-text", text); }
}
document.getElementById("np-copy").addEventListener("click", async () => {
  const b = document.getElementById("np-copy");
  // ISSUE-00027: the button copies the standing prompt, never run-specific text.
  try { await navigator.clipboard.writeText(document.getElementById("np-standing").textContent); b.textContent = "Copied"; }
  catch (err) { const r = document.createRange(); r.selectNodeContents(document.getElementById("np-standing")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); b.textContent = "Selected: press Ctrl+C"; }
  setTimeout(() => { b.textContent = "Copy the standing prompt"; }, 2500);
});
let mapSig = null;
function renderKey() {
  const key = document.getElementById("map-key");
  for (const s of TILE_STATES) { const k = el("span", null, TILE_LABEL[s]); k.style.setProperty("--c", TILE_COLOUR[s]); key.appendChild(k); }
}
let waitingOwner = new Set();
// ISSUE-00031: the GYR class of each amendment, by objective, the latest record winning. A routed
// row carries its class; an escalated red row says "gyr: red"; a run-4a row that the owner agent
// reclassified by hand names the class in its note.
let gyrByObjective = new Map();
function gyrClasses(decisions) {
  const out = new Map();
  for (const d of decisions || []) {
    const objective = (d.subject || "").split("--")[1];
    if (!objective || !objective.startsWith("amend-")) continue;
    const refs = (d.record && d.record.evidence && d.record.evidence.refs) || [];
    const hand = /Reclassified (GREEN|YELLOW|RED) under GYR/.exec(d.note || "");
    if (d.kind === "routed_green" || d.kind === "routed_yellow") out.set(objective, d.class);
    else if (d.class === "red" && refs.some((x) => x.startsWith("gyr: "))) out.set(objective, "red");
    else if (hand) out.set(objective, hand[1].toLowerCase());
  }
  return out;
}
function renderMap(events) {
  if (!asksList) return;
  const tiles = askTiles(asksList.concat(amendAsks(events)), events, waitingOwner);
  // The header counts asks; amendments show their own count.
  const askOnly = tiles.filter((t) => t.canonical !== "spec");
  const amends = tiles.filter((t) => t.canonical === "spec");
  const admitted = askOnly.filter((t) => t.state === "admitted" || t.state === "deployed").length;
  const deployed = askOnly.filter((t) => t.state === "deployed").length;
  const active = tiles.filter((t) => ["claimed", "forked", "submitted", "checking", "owner", "sent back"].includes(t.state)).length;
  const amendText = amends.length ? " \\u00b7 " + amends.filter((t) => t.state === "admitted").length + " of " + plural(amends.length, "amendment") + " admitted" : "";
  setText("map-count", admitted + " of " + plural(askOnly.length, "ask") + " admitted" + (deployed < admitted ? ", " + deployed + " deployed" : "") + amendText + (active ? " \\u00b7 " + active + " in progress" : ""));
  const pct = (n) => (askOnly.length ? (100 * n) / askOnly.length : 0) + "%";
  document.getElementById("bar-built").style.width = pct(deployed);
  document.getElementById("bar-admitted").style.width = pct(admitted - deployed);
  const ageText = (t) => (t.last ? t.last.verdict + " " + ageOf(t.last.at) + " ago" : "no verdict yet");
  const sig = JSON.stringify(tiles.map((t) => [t.id, t.state, t.agents, t.forks, t.last && t.last.at, t.last && ageOf(t.last.at), gyrByObjective.get(t.id) || null]));
  if (sig === mapSig) return;
  mapSig = sig;
  const groups = document.getElementById("map-groups");
  groups.replaceChildren();
  for (const canonical of [...new Set(tiles.map((t) => t.canonical))]) {
    groups.appendChild(el("div", "group-title", GROUP_TITLE[canonical] || "SPEC 8 · " + canonical));
    const grid = el("div", "tiles");
    for (const t of tiles.filter((x) => x.canonical === canonical)) {
      const tile = el("div", "tile" + (DARK_TILES.includes(t.state) ? " dark" : "") + (t.state === "checking" ? " checking" : ""));
      tile.style.setProperty("--c", TILE_COLOUR[t.state]);
      tile.title = t.id + " (" + t.canonical + ", " + t.label + "): " + TILE_LABEL[t.state];
      tile.append(
        el("div", "tid", t.id),
        el("div", "tst", TILE_LABEL[t.state] + (t.tag ? " " + t.tag : "") + " \\u00b7 " + t.label),
        el("div", "tmeta", t.agents.length ? t.agents.join(", ") : "no agent on it"),
        el("div", "tmeta", plural(t.forks, "fork") + " \\u00b7 " + ageText(t)),
      );
      const cls = gyrByObjective.get(t.id);
      if (cls) tile.append(el("span", "chip " + cls, "GYR " + cls));
      grid.appendChild(tile);
    }
    groups.appendChild(grid);
  }
}
renderKey();

// ---- state
let asksLedger = null;
let lastView = null;
function hero(rows, runs, events) {
  lastView = { rows, runs, events };
  // Probe actors never set the arena's state word (ISSUE-00023).
  const states = rows.filter((r) => !isProbeActor(r.actor)).map((r) => r.state);
  const word = states.includes("ruling") || states.includes("awaiting-verdict") ? "ruling" : states.includes("building") || states.includes("claiming") ? "building" : rows.length ? "idle" : "no actor yet";
  const latest = events.length ? events[events.length - 1].at : null;
  const parts = [];
  parts.push(asksLedger ? asksLedger.built + " of " + plural(asksLedger.total, "ask") + " built" + (asksLedger.open ? ", " + asksLedger.open + " open" : "") : "ledger unknown");
  parts.push(latest ? word + " since " + fmtTime(latest) + " (" + ageOf(latest) + " ago)" : word);
  const story = runs.find((r) => !isProbeActor(r.actor));
  if (story) parts.push("last run " + story.actor + ": " + runSummary(story));
  setText("hero", parts.join(" \\u00b7 "));
  document.title = "arena \\u00b7 " + word + (asksLedger ? " \\u00b7 " + asksLedger.built + " of " + asksLedger.total : "");
}
async function tick() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const s = await res.json();
    NOW = Date.now();
    const events = eventsOf(s);
    const canonicals = s.repos.filter((r) => r.role === "canonical");
    const candidates = s.repos.filter((r) => r.role === "candidate");
    const pushes = events.filter((e) => e.kind === "push");
    const verdicts = s.verdicts || [];
    const rows = roster(events);
    const runs = runsOf(events);
    hero(rows, runs, events);
    renderDecisions(s);
    waitingOwner = new Set((s.decisions || []).filter((d) => d.kind === "amendment" && d.status === "open").map((d) => d.subject));
    gyrByObjective = gyrClasses(s.decisions);
    renderMap(events);
    renderNextPrompt(events);
    renderPaStatus(events);

    const busy = rows.filter((r) => r.state !== "idle");
    setText("roster-title", rows.length === 0 ? "Who is doing what: no actor yet" : busy.length === 0 ? "Nothing is happening: every actor idle, latest activity " + ageOf(rows.map((r) => r.since).sort().pop()) + " ago" : busy.map((r) => r.actor + " " + r.state.replace("-", " ")).join(", ") + "; " + (rows.length - busy.length) + " of " + rows.length + " idle");
    fill("roster", rows, (r) => [
      r.actor === "authority" ? "admission authority" : isProbeActor(r.actor) ? { cls: "chip probe", text: "PROBE " + r.actor } : r.actor,
      { cls: "state " + r.state, text: r.state === "idle" ? "idle since " + fmtTime(r.since) : r.state.replace("-", " ") + " for " + ageOf(r.since) },
      r.line,
      r.open + " open, " + r.owed + " awaiting a verdict",
      age(r.since),
    ]);

    const all = events.concat(decisionEvents(s), commsEvents()).sort(byTime);
    const feed = feedRows(all).reverse();
    const foldedCount = all.length - feed.length;
    setText("feed-title", feed.length === 0 ? "Just happened: nothing yet" : "Last: " + actorOf(feed[0].e) + " " + lineOf(feed[0].e) + ", " + ageOf(feed[0].e.at) + " ago \\u00b7 " + plural(feed.length, "row") + " in all, newest 25 below; " + plural(foldedCount, "authority step") + " folded under " + plural(feed.filter((r) => r.fold.length).length, "verdict"));
    const feedRow = ({ e, fold }) => [when(e.at), { cls: e.probe ? "chip probe" : "chip", text: (e.probe ? "PROBE " : "") + actorOf(e) }, { cls: e.kind === "verdict" ? "chip " + e.verdict : e.gyr ? "chip " + e.cls : "chip", text: e.kind === "verdict" ? e.verdict : e.gyr ? "GYR " + e.cls : e.kind }, { fold, text: lineOf(e) }, age(e.at)];
    fill("feed", feed.slice(0, 25), feedRow, (r) => r.e.subject);
    fill("feed-rest", feed.slice(25), feedRow, (r) => r.e.subject);
    document.getElementById("feed-more").style.display = feed.length > 25 ? "block" : "none";
    setText("feed-more-summary", "Show all " + feed.length + " (" + (feed.length - 25) + " more)");

    const story = runs.find((r) => !isProbeActor(r.actor));
    const probeRuns = runs.filter((r) => isProbeActor(r.actor)).length;
    setText("runs-title", runs.length === 0 ? "Runs: none yet" : plural(runs.length - probeRuns, "run") + (probeRuns ? " and " + plural(probeRuns, "probe run") : "") + (story ? "; the last run, " + story.actor + ", " + runSummary(story) : "; no run yet beyond probes"));
    const cards = document.getElementById("runs");
    cards.replaceChildren();
    for (const r of runs) {
      const card = document.createElement("div"); card.className = "card";
      const t = document.createElement("div"); t.className = "t"; t.textContent = (isProbeActor(r.actor) ? "PROBE " : "") + r.actor + " \\u00b7 " + fmtTime(r.started) + " to " + endTime(r.started, r.ended);
      const d = document.createElement("div"); d.className = "muted"; d.textContent = runSummary(r) + " \\u00b7 " + ageOf(r.ended) + " ago";
      card.append(t, d); cards.appendChild(card);
    }
    document.getElementById("runs-empty").style.display = runs.length ? "none" : "block";

    const latestVerdict = (name) => verdicts.filter((v) => v.candidate === name).slice(-1)[0];
    const byVerdict = { ADMIT: 0, REFUSE: 0, SEND_BACK: 0, none: 0 };
    for (const r of candidates) { const v = latestVerdict(r.name); byVerdict[v ? v.verdict : "none"]++; }
    setText("candidates-title", candidates.length === 0 ? "Candidates: none yet" : plural(candidates.length, "candidate fork") + ": " + byVerdict.ADMIT + " admitted, " + byVerdict.REFUSE + " refused, " + byVerdict.SEND_BACK + " sent back, " + byVerdict.none + " awaiting a first ruling");
    fill("candidates", candidates.slice().reverse(), (r) => {
      const mine = pushes.filter((e) => e.subject === r.name && e.ref === "refs/heads/main");
      const head = mine.length ? mine[mine.length - 1].commit : null;
      const last = latestVerdict(r.name);
      const lastAt = mine.length || last ? [mine.length ? mine[mine.length - 1].at : "", last ? last.ruled_at : ""].sort().pop() : r.created_at;
      return [{ parts: r.name }, r.parent, head ? short(head) : "no push yet", mine.length, last ? { text: last.verdict, cls: last.verdict, title: last.reason } : "none yet", age(lastAt)];
    });

    const counts = { ADMIT: 0, REFUSE: 0, SEND_BACK: 0 };
    for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
    setText("verdicts-title", verdicts.length === 0 ? "Admission: no ruling yet" : plural(verdicts.length, "ruling") + ": " + counts.ADMIT + " ADMIT, " + counts.REFUSE + " REFUSE, " + counts.SEND_BACK + " SEND_BACK; the last one " + ageOf(verdicts[verdicts.length - 1].ruled_at) + " ago");
    fill("verdicts", verdicts.slice().reverse(), (v) => [when(v.ruled_at), { parts: v.candidate }, { text: v.verdict, cls: v.verdict }, v.reason, v.merge_commit ? (v.merge_commit.slice(0, 10) + (v.tag ? " " + v.tag : "")) : "", age(v.ruled_at)]);

    setText("repos-title", plural(s.repos.length, "repository", "repositories") + ": " + plural(canonicals.length, "canonical") + ", " + plural(candidates.length, "candidate fork"));
    fill("repos", s.repos, (r) => [r.name, r.role, r.parent || "", when(r.created_at), age(r.created_at)]);
    setText("updated", "Last update " + new Date().toLocaleTimeString());
  } catch (err) {
    setText("updated", "Update failed: " + err);
  }
}
async function runs() {
  try {
    const r = await (await fetch("/api/runs", { cache: "no-store" })).json();
    if (r.ok) PROMPTS = r.runs;
    else setText("np-status", "RUNS.md unreadable: " + r.error);
  } catch (err) {
    setText("np-status", "runs read failed: " + err);
  }
}
async function spec() {
  const ol = document.getElementById("spec");
  const empty = document.getElementById("spec-empty");
  await runs();
  try {
    const res = await fetch("/api/asks", { cache: "no-store" });
    const s = await res.json();
    if (!s.ok) { ol.replaceChildren(); empty.style.display = "block"; empty.textContent = "spec canonical: " + (s.error || "unavailable"); asksLedger = null; return; }
    ol.replaceChildren();
    for (const a of s.asks) {
      const li = document.createElement("li");
      li.className = a.built ? "built" : a.admitted ? "admitted" : "open";
      const mark = document.createElement("code");
      mark.textContent = a.built ? "[x] " : a.admitted ? "[~] " : "[ ] ";
      const lbl = document.createElement("span");
      lbl.className = "lbl " + a.label;
      lbl.textContent = a.label;
      li.append(mark, lbl, a.id + "  (" + a.canonical + ")" + (a.built ? "  " + (a.tag || "") + " from " + partsText(a.admitted_from) : a.admitted ? "  admitted, deploying" : ""));
      if (a.admitted_from) li.title = a.admitted_from;
      ol.appendChild(li);
    }
    empty.style.display = s.asks.length ? "none" : "block";
    const built = s.asks.filter((a) => a.built).length;
    const open = s.asks.filter((a) => !a.admitted).length;
    asksLedger = { built, total: s.asks.length, open };
    asksList = s.asks;
    if (lastView) { hero(lastView.rows, lastView.runs, lastView.events); mapSig = null; renderMap(lastView.events); renderNextPrompt(lastView.events); renderPaStatus(lastView.events); }
    setText("spec-title", s.asks.length === 0 ? "Outcome so far: the spec carries no ask yet" : built === s.asks.length ? "Outcome so far: every ask built, " + built + " of " + s.asks.length : "Outcome so far: " + built + " of " + s.asks.length + " asks built, " + open + " open");
  } catch (err) {
    empty.style.display = "block"; empty.textContent = "asks read failed: " + err;
  }
}
// ---- comms: both directions, newest first; the headline names who spoke last and what waits
async function comms() {
  try {
    const res = await fetch("/api/comms", { cache: "no-store" });
    const s = await res.json();
    if (!s.ok) { setText("comms-title", "Comms: " + (s.error || "unavailable")); return; }
    const all = COMMS_REPOS.flatMap((r) => (s.repos[r] && s.repos[r].messages) || []);
    all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    commsMessages = all;
    const bad = COMMS_REPOS.reduce((n, r) => n + ((s.repos[r] && s.repos[r].invalid) || []).length, 0);
    const forge = all.filter((m) => m.repo === "forge-to-owner").length;
    const owner = all.length - forge;
    const last = all[all.length - 1];
    setText("comms-title", all.length === 0 ? "Comms: no message yet" : "Comms: " + plural(forge, "message") + " from the forge, " + plural(owner, "answer") + " from the owner; last " + last.from + " " + last.kind + ", " + ageOf(last.at) + " ago" + (bad ? "; " + plural(bad, "file") + " not readable as a message" : ""));
    const list = document.getElementById("comms-list");
    list.replaceChildren();
    for (const m of all.slice().reverse().slice(0, 20)) {
      const box = el("div", "msg" + (m.repo === "owner-to-forge" ? " owner" : ""));
      const head = el("div", "mh");
      const who = document.createElement("b"); who.textContent = m.from + " to " + m.to;
      head.append(who, " \\u00b7 " + fmtTime(m.at) + " \\u00b7 re " + m.re + " \\u00b7 ");
      head.append(el("span", "chip", m.kind));
      if (m.class) head.append(" ", el("span", "chip " + m.class, m.class));
      const lines = m.body.split("\\n");
      const first = lines.find((l) => l.trim()) || "";
      const more = el("details");
      more.append(el("summary", "", "Read all " + plural(lines.length, "line")), el("pre", "", m.body));
      box.append(head, el("div", "mf", first), more);
      list.appendChild(box);
    }
    document.getElementById("comms-empty").style.display = all.length ? "none" : "block";
  } catch (err) {
    setText("comms-title", "Comms: read failed: " + err);
  }
}
// ---- push (ISSUE-00025): a WebSocket of recorded changes drives the board; polling is the
// fallback, every 2 s with no socket and every 15 s with one.
let sock = null, sockOpen = false, lastTick = 0, lastComms = 0, lastSpec = 0, pushed = 0;
const pulse = { tick: null, comms: null, spec: null };
function soon(name, fn) { if (!pulse[name]) pulse[name] = setTimeout(() => { pulse[name] = null; fn(); }, 150); }
function liveLine() { setText("live-mode", sockOpen ? "Live view: pushed over a WebSocket (" + plural(pushed, "change") + " so far), polling every 15 s as a fallback." : "Live view: polling, state every 2 seconds, asks every 10 seconds."); }
function subscribe() {
  try { sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/arena/subscribe"); }
  catch (err) { setTimeout(subscribe, 10000); return; }
  sock.onopen = () => { sockOpen = true; liveLine(); };
  sock.onmessage = (m) => {
    let c = null;
    try { c = JSON.parse(m.data); } catch (err) { return; }
    if (!c || c.kind === "hello" || c.kind === "pong") return;
    pushed += 1; liveLine();
    if (c.kind === "push" && COMMS_REPOS.includes(c.repo)) { soon("comms", () => { lastComms = Date.now(); comms(); }); return; }
    if (c.kind === "push" && c.repo === "spec") soon("spec", () => { lastSpec = Date.now(); spec(); });
    soon("tick", () => { lastTick = Date.now(); tick(); });
  };
  sock.onclose = () => { sockOpen = false; liveLine(); setTimeout(subscribe, 5000); };
}
const every = (ms, last, fn) => () => { if (!sockOpen || Date.now() - last() >= 15000) { fn(); } };
tick(); spec(); comms(); subscribe();
lastTick = lastSpec = lastComms = Date.now();
setInterval(every(2000, () => lastTick, () => { lastTick = Date.now(); tick(); }), 2000);
setInterval(every(10000, () => lastSpec, () => { lastSpec = Date.now(); spec(); }), 10000);
setInterval(every(5000, () => lastComms, () => { lastComms = Date.now(); comms(); }), 5000);
setInterval(() => { if (sockOpen) sock.send("ping"); }, 30000);
</script>
</body>
</html>`;
