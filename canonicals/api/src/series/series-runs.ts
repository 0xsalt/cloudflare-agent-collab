// Open ask: series-runs. Replace this stub; the check is checks/series-runs.test.ts. SPEC.md "Ask: series-runs".
import { notBuilt, type ObsEvent, type SeriesContext } from "../events";

export const ask = "series-runs";

export function derive(_events: readonly ObsEvent[], _ctx: SeriesContext): unknown {
  return notBuilt(ask);
}
