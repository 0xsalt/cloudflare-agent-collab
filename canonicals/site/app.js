// The observatory loader. Reserved path. It lists the asks from /api/asks, loads every view
// module, fetches each view's series from api through /obs, and lets the view render it.
// A view that is still a stub shows OPEN ASK; a series that is not built yet shows WAITING.
// The page title carries the state: "<state> · <built> of <asks> built".

const VIEWS = ["view-now", "view-feed", "view-runs", "view-decisions", "view-architecture-live", "view-push-rate", "view-time-to-admit", "view-verdict-matrix", "view-trace"];
const modules = {};
let state = "";
let ledger = "";

function note(el, cls, text) {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  el.replaceChildren(d);
}

async function loadViews() {
  for (const id of VIEWS) {
    try {
      modules[id] = await import("/site/views/" + id + ".js?t=" + Date.now());
    } catch (err) {
      modules[id] = { ask: id, built: false, error: String(err) };
    }
  }
}

async function getJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// The state word for the title: ruling or awaiting a verdict beats building, which beats idle.
function stateOf(now) {
  const states = (now.actors || []).map((a) => a.state);
  if (states.includes("ruling") || states.includes("awaiting-verdict")) return "ruling";
  if (states.includes("building") || states.includes("claiming")) return "building";
  if (states.length === 0) return "no actor yet";
  return "idle";
}

async function renderView(id, builtSeries) {
  const section = document.querySelector('[data-view="' + id + '"] .body');
  const mod = modules[id];
  if (!mod || mod.built !== true) return note(section, "open", "OPEN ASK " + id + ": no candidate admitted yet");
  if (builtSeries[mod.series] !== true) return note(section, "waiting", "WAITING on api ask " + mod.series);
  let path = "/obs/series/" + mod.series;
  if (id === "view-trace") {
    const subject = document.getElementById("trace-subject").value;
    if (!subject) return note(section, "waiting", "no candidates yet");
    path += "?subject=" + encodeURIComponent(subject);
  }
  const r = await getJson(path);
  if (r.status !== 200 || !r.body.ok) return note(section, "error", mod.series + ": " + (r.body.error || "HTTP " + r.status));
  if (id === "view-now") state = stateOf(r.body.data);
  try {
    mod.render(section, r.body.data, document);
  } catch (err) {
    note(section, "error", id + " failed to render: " + err);
  }
}

async function renderAsks() {
  const list = document.getElementById("asks-list");
  const head = document.getElementById("asks-headline");
  const r = await getJson("/api/asks");
  if (!r.body.ok) {
    head.textContent = "ledger unavailable: " + (r.body.error || r.status);
    return;
  }
  const asks = r.body.asks;
  const built = asks.filter((a) => a.built).length;
  const open = asks.filter((a) => !a.admitted).length;
  const deploying = asks.length - built - open;
  ledger = built + " of " + asks.length + " built";
  head.textContent = asks.length === 0 ? "The spec carries no ask yet" : built === asks.length ? "Every ask is built: " + ledger : ledger + "; " + open + " open" + (deploying ? "; " + deploying + " admitted, deploying" : "") + ". Labels: the owner's confidence the ask is wanted.";
  list.replaceChildren();
  for (const ask of asks) {
    const li = document.createElement("li");
    li.className = ask.built ? "built" : ask.admitted ? "partial" : "open";
    li.textContent = (ask.built ? "BUILT  " : ask.admitted ? "ADMITTED  " : "OPEN  ") + ask.id + "  " + ask.canonical + "  " + ask.label + (ask.tag ? "  " + ask.tag : "");
    list.appendChild(li);
  }
}

async function refreshSubjects() {
  const select = document.getElementById("trace-subject");
  const s = await getJson("/api/state");
  const names = (s.body.repos || []).filter((r) => r.role === "candidate").map((r) => r.name).reverse();
  const keep = select.value;
  if (names.join() === Array.from(select.options).map((o) => o.value).join()) return;
  select.replaceChildren();
  for (const n of names) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    select.appendChild(o);
  }
  if (names.includes(keep)) select.value = keep;
}

async function tick() {
  try {
    const series = await getJson("/obs/series");
    const builtSeries = series.body.ok ? series.body.series : {};
    await refreshSubjects();
    await renderAsks();
    for (const id of VIEWS) await renderView(id, builtSeries);
    const title = (state ? state + " · " : "") + ledger;
    document.title = title ? "observatory · " + title : "observatory";
    document.getElementById("state").textContent = title;
    document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById("updated").textContent = "Update failed: " + err;
  }
}

let views = 0;
async function loop() {
  // Re-import the views every 30 s, so an admitted view appears without a reload.
  if (views++ % 6 === 0) await loadViews();
  await tick();
  setTimeout(loop, 5000);
}

document.getElementById("trace-subject").addEventListener("change", tick);
loop();
