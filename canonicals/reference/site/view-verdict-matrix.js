export const ask = "view-verdict-matrix";
export const series = "series-verdict-matrix";
export const built = true;
export function render(root, data, doc) {
  const table = doc.createElement("table");
  for (const r of data.rows) {
    const tr = doc.createElement("tr");
    tr.setAttribute("data-row", r.objective + "/" + r.world + "/" + r.harness);
    for (const k of ["candidates", "admit", "refuse", "send_back", "owed"]) tr.setAttribute("data-" + k.replace("_", "-"), r[k]);
    for (const v of [r.objective, r.world, r.harness, r.candidates, r.admit, r.refuse, r.send_back, r.owed]) {
      const td = doc.createElement("td");
      td.textContent = String(v);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  root.replaceChildren(table);
}
