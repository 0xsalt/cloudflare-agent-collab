export const ask = "view-time-to-admit";
export const series = "series-time-to-admit";
export const built = true;
export function render(root, data, doc) {
  const stats = doc.createElement("div");
  for (const k of ["p50", "p90", "max"]) {
    const s = doc.createElement("span");
    s.setAttribute("data-stat", k);
    s.textContent = k + " " + (data[k] == null ? "-" : data[k] + " s") + "  ";
    stats.appendChild(s);
  }
  const list = doc.createElement("ol");
  for (const x of data.samples) {
    const li = doc.createElement("li");
    li.setAttribute("data-candidate", x.candidate);
    li.setAttribute("data-seconds", x.seconds);
    li.textContent = x.seconds + " s  " + x.candidate;
    list.appendChild(li);
  }
  root.replaceChildren(stats, list);
}
