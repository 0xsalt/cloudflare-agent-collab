// The observatory api: serves normalized events and the derived series. Reserved path.
// It reads the arena through a service binding to the control Worker, so no URL is configured.

import { fromArenaState, NotBuiltError, type ArenaState, type ObsEvent, type SeriesContext } from "./events";
import { buildFeed } from "../feed";
import * as pushRate from "./series/series-push-rate";
import * as timeToAdmit from "./series/series-time-to-admit";
import * as verdictMatrix from "./series/series-verdict-matrix";
import * as warmUpLoss from "./series/series-warm-up-loss";
import * as queueLag from "./series/series-queue-lag";
import * as trace from "./series/series-trace";
import * as architecture from "./series/series-architecture";
import * as now from "./series/series-now";
import * as feed from "./series/series-feed";
import * as runs from "./series/series-runs";
import * as decisions from "./series/series-decisions";

type Derive = (events: readonly ObsEvent[], ctx: SeriesContext) => unknown;

const SERIES: Record<string, Derive> = {
  [pushRate.ask]: pushRate.derive,
  [timeToAdmit.ask]: timeToAdmit.derive,
  [verdictMatrix.ask]: verdictMatrix.derive,
  [warmUpLoss.ask]: warmUpLoss.derive,
  [queueLag.ask]: queueLag.derive,
  [trace.ask]: trace.derive,
  [architecture.ask]: architecture.derive,
  [now.ask]: now.derive,
  [feed.ask]: feed.derive,
  [runs.ask]: runs.derive,
  [decisions.ask]: decisions.derive,
};

interface ApiEnv {
  readonly CONTROL: { fetch(input: string): Promise<Response> };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function arenaState(env: ApiEnv): Promise<ArenaState> {
  const res = await env.CONTROL.fetch("https://control/api/state");
  if (!res.ok) throw new Error(`control /api/state returned ${res.status}`);
  return (await res.json()) as ArenaState;
}

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ ok: false, error: "GET only" }, 405);

    if (url.pathname === "/series") {
      const built: Record<string, boolean> = {};
      const events = fromArenaState(await arenaState(env));
      for (const [ask, derive] of Object.entries(SERIES)) {
        try {
          derive(events, { now: new Date() });
          built[ask] = true;
        } catch (err) {
          built[ask] = !(err instanceof NotBuiltError);
        }
      }
      return json({ ok: true, series: built });
    }

    const ask = url.pathname.match(/^\/series\/([a-z0-9-]+)$/)?.[1];
    if (ask !== undefined) {
      const derive = SERIES[ask];
      if (derive === undefined) return json({ ok: false, error: `no series ${ask}` }, 404);
      const events = fromArenaState(await arenaState(env));
      const subject = url.searchParams.get("subject") ?? undefined;
      try {
        return json({ ok: true, ask, data: derive(events, { now: new Date(), subject }) });
      } catch (err) {
        if (err instanceof NotBuiltError) return json({ ok: false, ask, built: false, error: err.message }, 501);
        return json({ ok: false, ask, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === "/events") return json({ ok: true, events: fromArenaState(await arenaState(env)) });

    if (url.pathname === "/feed") {
      const state = await arenaState(env);
      return json(buildFeed((state.events ?? []).map((e) => ({ ...e })), new Date()));
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
