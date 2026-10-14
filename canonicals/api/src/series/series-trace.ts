// Open ask: series-trace. Replace this stub; the check is checks/series-trace.test.ts. SPEC.md "Ask: series-trace".
import { notBuilt, type ObsEvent, type SeriesContext } from "../events";

export const ask = "series-trace";

export function derive(_events: readonly ObsEvent[], _ctx: SeriesContext): unknown {
  return notBuilt(ask);
}
