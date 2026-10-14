export const ask = "view-architecture-live";
export const series = "series-architecture";
export const built = true;
function box(doc, cls, attrs, text) {
  const el = doc.createElement("div");
  el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.textContent = text;
  return el;
}
export function render(root, data, doc) {
  const platform = box(doc, "layer platform", { "data-layer": "platform" }, "");
  for (const n of ["cloudflare", "control", "queue", "durable-object"]) platform.appendChild(box(doc, "node", { "data-node": n }, n));
  const worlds = box(doc, "layer worlds", { "data-layer": "worlds" }, "");
  for (const w of data.worlds) worlds.appendChild(box(doc, "node", { "data-world": w.world, "data-forks": w.forks }, w.world + " (" + w.forks + ")"));
  const canon = box(doc, "layer canonicals", { "data-layer": "canonicals" }, "");
  for (const c of data.canonicals) canon.appendChild(box(doc, "node", { "data-canonical": c.name, "data-forks": c.forks }, c.name + " (" + c.forks + ")"));
  const forks = box(doc, "layer forks", { "data-layer": "forks" }, "");
  for (const f of data.forks) forks.appendChild(box(doc, "node", { "data-fork": f.name, "data-in": f.canonical, "data-from": f.world, "data-verdict": f.verdict ?? "none" }, f.name));
  const ops = doc.createElement("ol");
  for (const o of data.operations) {
    const li = doc.createElement("li");
    li.setAttribute("data-op", o.kind);
    li.setAttribute("data-at", o.at);
    li.setAttribute("data-edge", o.from + "->" + o.to);
    li.textContent = o.at + " " + o.kind + " " + o.from + " -> " + o.to;
    ops.appendChild(li);
  }
  root.replaceChildren(platform, worlds, canon, forks, ops);
}
