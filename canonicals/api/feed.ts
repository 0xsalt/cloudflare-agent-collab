// The observatory feed: a one-file Worker that derives a JSON feed from the control Worker's
// /api/state. Each push event in the arena becomes one feed item.
//
// STATE_URL is the control Worker's base URL. It is configuration, never committed.

export interface StateEvent {
  readonly id: number;
  readonly type: string;
  readonly repo: string;
  readonly ref: string | null;
  readonly after: string | null;
  readonly message: string | null;
  readonly received_at: string;
}

export interface FeedItem {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly ref: string | null;
  readonly commit: string | null;
  readonly published: string;
}

export interface Feed {
  readonly title: string;
  readonly updated: string;
  readonly items: readonly FeedItem[];
}

export function buildFeed(events: readonly StateEvent[], now: Date): Feed {
  return {
    title: "agent-collab arena",
    updated: now.toISOString(),
    items: events.map((e) => ({
      id: `event-${e.id}`,
      title: e.message ?? `${e.type} on ${e.repo}`,
      repo: e.repo,
      ref: e.ref,
      commit: e.after,
      published: new Date(e.received_at).toISOString(),
    })),
  };
}

interface FeedEnv {
  readonly STATE_URL: string;
}

export default {
  async fetch(_request: Request, env: FeedEnv): Promise<Response> {
    const res = await fetch(`${env.STATE_URL}/api/state`);
    if (!res.ok) return Response.json({ error: `state returned ${res.status}` }, { status: 502 });
    const state = (await res.json()) as { events?: StateEvent[] };
    return Response.json(buildFeed(state.events ?? [], new Date()), {
      headers: { "cache-control": "no-store" },
    });
  },
};
