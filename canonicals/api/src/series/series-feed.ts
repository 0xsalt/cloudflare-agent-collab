// Open ask: series-feed. Replace this stub; the check is checks/series-feed.test.ts. SPEC.md "Ask: series-feed".
import { notBuilt, type ObsEvent, type SeriesContext } from "../events";

export const ask = "series-feed";

export function derive(_events: readonly ObsEvent[], _ctx: SeriesContext): unknown {
  return notBuilt(ask);
}
