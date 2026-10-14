// Open ask: series-queue-lag. Replace this stub; the check is checks/series-queue-lag.test.ts. SPEC.md "Ask: series-queue-lag".
import { notBuilt, type ObsEvent, type SeriesContext } from "../events";

export const ask = "series-queue-lag";

export function derive(_events: readonly ObsEvent[], _ctx: SeriesContext): unknown {
  return notBuilt(ask);
}
