export const ask = "view-trace";
export const series = "series-trace";
export const built = true;
export function render(root, data, doc) {
  const h = doc.createElement("div");
  h.textContent = data.candidate;
  const ol = doc.createElement("ol");
  for (const s of data.steps) {
    const li = doc.createElement("li");
    li.setAttribute("data-step", s.kind);
    li.setAttribute("data-at", s.at);
    li.textContent = s.at + "  " + s.kind + "  " + s.detail;
    ol.appendChild(li);
  }
  root.replaceChildren(h, ol);
}
