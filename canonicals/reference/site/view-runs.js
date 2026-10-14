export const ask = "view-runs";
export const series = "series-runs";
export const built = true;
function localTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function minutes(a, b) {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
}
function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}
function summary(r) {
  const verdicts = [];
  if (r.admit) verdicts.push(r.admit + " ADMIT");
  if (r.refuse) verdicts.push(r.refuse + " REFUSE");
  if (r.send_back) verdicts.push(r.send_back + " SEND_BACK");
  if (r.owed) verdicts.push(r.owed + " awaiting a verdict");
  const median = r.median_seconds_to_admit === null ? "no admit yet" : "median " + r.median_seconds_to_admit + " s to admit";
  return r.claims + " " + (r.claims === 1 ? "claim" : "claims") + " · " + (verdicts.length ? verdicts.join(", ") : "no verdict yet") + " · " + median;
}
export function render(root, data, doc) {
  const runs = data.runs || [];
  const head = el(doc, "div", "headline", "");
  head.setAttribute("data-headline", "runs");
  head.setAttribute("data-runs", String(runs.length));
  head.textContent = runs.length === 0 ? "No run yet" : "Last run: " + runs[0].actor + ", " + localTime(runs[0].started) + " to " + localTime(runs[0].ended) + " (" + minutes(runs[0].started, runs[0].ended) + " min), " + summary(runs[0]);
  const list = doc.createElement("div");
  list.className = "cards";
  for (const r of runs) {
    const card = doc.createElement("div");
    card.className = "card";
    card.setAttribute("data-run", r.actor + "@" + r.started);
    card.setAttribute("data-actor", r.actor);
    card.setAttribute("data-started", r.started);
    card.setAttribute("data-ended", r.ended);
    card.setAttribute("data-claims", String(r.claims));
    card.setAttribute("data-slots", String(r.slots));
    card.setAttribute("data-candidates", String(r.candidates));
    card.setAttribute("data-admit", String(r.admit));
    card.setAttribute("data-refuse", String(r.refuse));
    card.setAttribute("data-send-back", String(r.send_back));
    card.setAttribute("data-owed", String(r.owed));
    card.setAttribute("data-median", r.median_seconds_to_admit === null ? "none" : String(r.median_seconds_to_admit));
    card.appendChild(el(doc, "div", "title", r.actor + " · " + localTime(r.started) + " to " + localTime(r.ended) + " · " + minutes(r.started, r.ended) + " min"));
    card.appendChild(el(doc, "div", "summary", summary(r)));
    list.appendChild(card);
  }
  root.replaceChildren(head, list);
}
