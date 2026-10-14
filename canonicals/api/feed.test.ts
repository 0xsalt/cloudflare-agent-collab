import { expect, test } from "bun:test";
import { buildFeed, type StateEvent } from "./feed";

// ISO-8601 in UTC with a Z suffix, as Date.prototype.toISOString() writes it.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const events: StateEvent[] = [
  { id: 1, type: "cf.artifacts.repo.pushed", repo: "site", ref: "refs/heads/main", after: "a".repeat(40), message: "Seed", received_at: "2026-10-07T06:00:00.000Z" },
  { id: 2, type: "cf.artifacts.repo.pushed", repo: "api", ref: "refs/heads/main", after: "b".repeat(40), message: null, received_at: "2026-10-07T06:00:05.123Z" },
];

test("feed timestamps are ISO-8601", () => {
  const feed = buildFeed(events, new Date("2026-10-07T06:01:00.000Z"));
  expect(feed.updated).toMatch(ISO_8601);
  expect(feed.items).toHaveLength(2);
  for (const item of feed.items) expect(item.published).toMatch(ISO_8601);
});
