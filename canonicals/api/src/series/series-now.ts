// Open ask: series-now. Replace this stub; the check is checks/series-now.test.ts. SPEC.md "Ask: series-now".
import { notBuilt, type ObsEvent, type SeriesContext } from "../events";

export const ask = "series-now";

export function derive(_events: readonly ObsEvent[], _ctx: SeriesContext): unknown {
  return notBuilt(ask);
}
