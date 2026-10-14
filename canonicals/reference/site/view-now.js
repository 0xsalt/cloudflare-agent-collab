export const ask = "view-now";
export const series = "series-now";
export const built = true;
const STATES = ["claiming", "building", "awaiting-verdict", "ruling", "idle"];
function age(seconds) {
  if (seconds < 60) return seconds + " s";
  const m = Math.floor(seconds / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  if (h < 48) return h + " h " + (m % 60) + " min";
  return Math.floor(h / 24) + " d";
}
function localTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
export function render(root, data, doc) {
  const now = Date.parse(data.now);
  const actors = data.actors || [];
  const counts = {};
  for (const a of actors) counts[a.state] = (counts[a.state] || 0) + 1;
  const busy = actors.filter((a) => a.state !== "idle");
  const head = el(doc, "div", "headline", "");
  head.setAttribute("data-headline", "now");
  head.setAttribute("data-actors", String(actors.length));
  for (const s of STATES) head.setAttribute("data-" + s, String(counts[s] || 0));
  if (actors.length === 0) head.textContent = "No actor has appeared yet";
  else if (busy.length === 0) {
    const latest = actors.map((a) => a.since).sort().at(-1);
    head.textContent = "Nothing is happening: every actor idle since " + localTime(latest) + " (" + age(Math.max(0, Math.round((now - Date.parse(latest)) / 1000))) + " ago)";
  } else head.textContent = busy.map((a) => a.actor + " " + a.state.replace("-", " ")).join(", ") + "; " + (counts.idle || 0) + " idle";
  const table = doc.createElement("table");
  table.className = "roster";
  for (const a of actors) {
    const tr = doc.createElement("tr");
    const secs = Math.max(0, Math.round((now - Date.parse(a.since)) / 1000));
    tr.setAttribute("data-actor", a.actor);
    tr.setAttribute("data-state", a.state);
    tr.setAttribute("data-since", a.since);
    tr.setAttribute("data-age", String(secs));
    tr.appendChild(el(doc, "td", "actor", a.actor === "authority" ? "admission authority" : a.world + " / " + a.harness));
    const state = a.state === "idle" ? "idle since " + localTime(a.since) : a.state.replace("-", " ") + " for " + age(secs);
    tr.appendChild(el(doc, "td", "state " + a.state, state));
    tr.appendChild(el(doc, "td", "line", a.last.line));
    tr.appendChild(el(doc, "td", "counts", a.open + " open, " + a.owed + " awaiting a verdict"));
    tr.appendChild(el(doc, "td", "age", age(secs) + " ago"));
    table.appendChild(tr);
  }
  root.replaceChildren(head, table);
}
