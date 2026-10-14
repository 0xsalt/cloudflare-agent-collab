export const ask = "view-decisions";
export const series = "series-decisions";
export const built = true;
function localTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
function headline(open, decided) {
  if (open.length === 0) return "No decision needs a human · " + decided.length + " decided";
  const first = open[0].summary || open[0].kind;
  return open.length + (open.length === 1 ? " decision needs" : " decisions need") + " a human · " + first + " · " + decided.length + " decided";
}
export function render(root, data, doc) {
  const open = data.open || [];
  const decided = data.decided || [];
  const head = el(doc, "div", "headline", headline(open, decided));
  head.setAttribute("data-headline", "decisions");
  head.setAttribute("data-open", String(open.length));
  head.setAttribute("data-decided", String(decided.length));
  const openList = doc.createElement("div");
  openList.className = "cards";
  for (const d of open) {
    const card = doc.createElement("div");
    card.className = "card " + d.class;
    card.setAttribute("data-decision", String(d.id));
    card.setAttribute("data-class", d.class);
    card.setAttribute("data-kind", d.kind);
    card.setAttribute("data-subject", d.subject);
    card.appendChild(el(doc, "div", "title", d.class + " · " + d.kind + " · " + d.subject + " · opened " + localTime(d.opened_at)));
    card.appendChild(el(doc, "div", "summary", d.summary || ""));
    card.appendChild(el(doc, "div", "recommend", "Recommended: " + (d.recommendation || "none") + (d.red_criteria.length ? " · " + d.red_criteria.join(", ") : "")));
    openList.appendChild(card);
  }
  const decidedList = doc.createElement("div");
  decidedList.className = "cards";
  for (const d of decided) {
    const row = doc.createElement("div");
    row.className = "card decided";
    row.setAttribute("data-decision", String(d.id));
    row.setAttribute("data-action", d.action === null ? "none" : d.action);
    const how = d.action === null ? "recorded" : d.action + " by " + (d.actor || "unknown");
    row.appendChild(el(doc, "div", "summary", d.class + " · " + (d.summary || d.kind) + " · " + how + " at " + localTime(d.decided_at || d.opened_at)));
    decidedList.appendChild(row);
  }
  root.replaceChildren(head, openList, decidedList);
}
