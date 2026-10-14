// The comms message format (ISSUE-00026): what the Worker accepts is what scripts/comms.ts writes.

import { expect, test } from "bun:test";
import { formatMessage, messagePath, parseMessage } from "../src/comms";

const AT = new Date("2026-10-09T07:05:09.123Z");

test("messagePath stamps UTC time and slugs the title", () => {
  expect(messagePath(AT, "Run 4a report: six questions!")).toBe("messages/20261009T070509Z-run-4a-report-six-questions.md");
  expect(messagePath(AT, "???")).toBe("messages/20261009T070509Z-message.md");
});

test("a formatted message parses back to its fields", () => {
  const path = messagePath(AT, "probe");
  const text = formatMessage({ from: "owner", to: "forge", re: "comms-probe", kind: "inform", class: "green", body: "First line.\n\nSecond paragraph." });
  const m = parseMessage("owner-to-forge", path, text);
  expect(m).toEqual({
    repo: "owner-to-forge", path, at: "2026-10-09T07:05:09Z", from: "owner", to: "forge", re: "comms-probe", kind: "inform", class: "green",
    body: "First line.\n\nSecond paragraph.",
  });
});

test("the forge's hand-written message parses, CRLF and all", () => {
  const text = "---\r\nfrom: forge/codex\r\nto: owner\r\nre: run-4a\r\nkind: question\r\n---\r\n\r\nWhich namespace?\r\n";
  const m = parseMessage("forge-to-owner", "messages/20261009T080000Z-q1.md", text);
  expect("error" in m ? m.error : m.kind).toBe("question");
  expect("error" in m ? null : m.class).toBeNull();
});

test("a malformed message names its fault", () => {
  const ok = "---\nfrom: forge\nto: owner\nre: x\nkind: question\n---\nbody\n";
  const err = (path: string, text: string): string => {
    const m = parseMessage("forge-to-owner", path, text);
    return "error" in m ? m.error : "parsed";
  };
  expect(err("notes/20261009T080000Z-q.md", ok)).toContain("path must be");
  expect(err("messages/20261399T080000Z-q.md", ok)).toContain("not a time");
  expect(err("messages/20261009T080000Z-q.md", "no front matter")).toContain("front matter");
  expect(err("messages/20261009T080000Z-q.md", ok.replace("kind: question", "kind: rant"))).toContain("kind must be");
  expect(err("messages/20261009T080000Z-q.md", ok.replace("re: x\n", ""))).toContain("from, to and re");
  expect(err("messages/20261009T080000Z-q.md", ok.replace("body\n", ""))).toContain("no body");
  expect(err("messages/20261009T080000Z-q.md", ok.replace("kind: question", "kind: answer\nclass: purple"))).toContain("class must be");
  expect(err("messages/20261009T080000Z-q.md", ok)).toBe("parsed");
});
