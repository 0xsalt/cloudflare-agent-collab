export const ask = "view-feed";
export const series = "series-feed";
export const built = true;
const SHOW = 25;
function age(seconds) {
  if (seconds < 60) return seconds + " s";
  const m = Math.floor(seconds / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  if (h < 48) return h + " h";
  return Math.floor(h / 24) + " d";
}
function localTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
function row(doc, now, item) {
  const li = doc.createElement("li");
  li.setAttribute("data-at", item.at);
  li.setAttribute("data-kind", item.kind);
  li.setAttribute("data-actor", item.actor);
  li.setAttribute("data-verdict", item.verdict === null || item.verdict === undefined ? "none" : item.verdict);
  li.setAttribute("title", item.subject);
  li.appendChild(el(doc, "span", "time", localTime(item.at)));
  li.appendChild(el(doc, "span", "chip actor", item.actor === "authority" ? "authority" : item.actor));
  li.appendChild(el(doc, "span", "chip kind " + item.kind + (item.verdict ? " " + item.verdict : ""), item.verdict || item.kind));
  li.appendChild(el(doc, "span", "line", item.line));
  li.appendChild(el(doc, "span", "age", age(Math.max(0, Math.round((now - Date.parse(item.at)) / 1000))) + " ago"));
  return li;
}
export function render(root, data, doc) {
  const now = Date.parse(data.now);
  const items = data.items || [];
  const shown = Math.min(SHOW, items.length);
  const head = el(doc, "div", "headline", "");
  head.setAttribute("data-headline", "feed");
  head.setAttribute("data-total", String(data.total));
  head.setAttribute("data-shown", String(shown));
  head.textContent = items.length === 0 ? "No events yet" : "Last: " + items[0].actor + " " + items[0].line + ", " + age(Math.max(0, Math.round((now - Date.parse(items[0].at)) / 1000))) + " ago; " + data.total + " events in all";
  const list = doc.createElement("ol");
  list.className = "feed";
  for (const item of items.slice(0, shown)) list.appendChild(row(doc, now, item));
  const parts = [head, list];
  if (items.length > shown) {
    const more = doc.createElement("details");
    more.setAttribute("data-more", String(items.length - shown));
    more.appendChild(el(doc, "summary", "", "Show all " + items.length + " (" + (items.length - shown) + " more)"));
    const rest = doc.createElement("ol");
    rest.className = "feed";
    for (const item of items.slice(shown)) rest.appendChild(row(doc, now, item));
    more.appendChild(rest);
    parts.push(more);
  }
  root.replaceChildren(...parts);
}
