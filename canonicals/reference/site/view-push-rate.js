export const ask = "view-push-rate";
export const series = "series-push-rate";
export const built = true;
export function render(root, data, doc) {
  const wrap = doc.createElement("div");
  wrap.className = "bars";
  let total = 0;
  for (const p of data.points) {
    total += p.count;
    const bar = doc.createElement("span");
    bar.setAttribute("data-minute", p.minute);
    bar.setAttribute("data-count", p.count);
    bar.style.height = 4 + p.count * 12 + "px";
    wrap.appendChild(bar);
  }
  const t = doc.createElement("div");
  t.setAttribute("data-total", total);
  t.textContent = total + " pushes in " + data.window_minutes + " minutes";
  root.replaceChildren(wrap, t);
}
