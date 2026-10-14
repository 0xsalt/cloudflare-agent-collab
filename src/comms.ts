// The comms channel (ISSUE-00026): the forge and the owner talk through two Artifacts repos in the
// namespace agent-collab-comms, one per direction. Each message is one new file,
// messages/<UTC timestamp>-<slug>.md, whose front matter names its sender, reader, subject and
// kind. The Worker, the board and scripts/comms.ts share this one definition.

export const COMMS_NAMESPACE = "agent-collab-comms";
export const FORGE_TO_OWNER = "forge-to-owner";
export const OWNER_TO_FORGE = "owner-to-forge";
export const COMMS_REPOS = [FORGE_TO_OWNER, OWNER_TO_FORGE] as const;
export type CommsRepo = (typeof COMMS_REPOS)[number];

// question, gap, blocker and report come from the forge; answer and inform come from the owner.
export const MESSAGE_KINDS = ["question", "gap", "blocker", "report", "answer", "inform"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
// An owner answer names the GYR class it was ruled under.
export const ANSWER_CLASSES = ["green", "yellow", "red"] as const;

// The stamp is UTC to the second; fractional digits before the Z are accepted and ignored, since
// one harness wrote microseconds and three of its messages never reached the board (2026-10-14).
export const MESSAGE_PATH = /^messages\/(\d{8}T\d{6})\d{0,9}Z-([a-z0-9-]{1,60})\.md$/;
const MAX_BODY = 16_000;
const MAX_FIELD = 200;

export interface Message {
  repo: CommsRepo;
  path: string;
  /** ISO time from the file name. */
  at: string;
  from: string;
  to: string;
  re: string;
  kind: MessageKind;
  class: (typeof ANSWER_CLASSES)[number] | null;
  body: string;
}

export const isCommsRepo = (v: unknown): v is CommsRepo => typeof v === "string" && (COMMS_REPOS as readonly string[]).includes(v);

/** Parses one message file. Returns the message, or the reason it is not one. */
export function parseMessage(repo: CommsRepo, path: string, text: string): Message | { error: string } {
  const m = path.match(MESSAGE_PATH);
  if (m === null) return { error: "path must be messages/<YYYYMMDDTHHMMSSZ>-<slug>.md" };
  const stamp = m[1] ?? "";
  const at = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  if (Number.isNaN(Date.parse(at))) return { error: "the file name's timestamp is not a time" };
  const fm = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm === null) return { error: "the file must open with a --- front matter block" };
  const fields = new Map<string, string>();
  for (const line of (fm[1] ?? "").split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*?)\s*$/);
    if (kv?.[1] !== undefined) fields.set(kv[1], kv[2] ?? "");
  }
  const need = (k: string): string | null => {
    const v = fields.get(k);
    return v !== undefined && v.length > 0 && v.length <= MAX_FIELD ? v : null;
  };
  const from = need("from");
  const to = need("to");
  const re = need("re");
  const kind = need("kind");
  if (from === null || to === null || re === null) return { error: "front matter needs from, to and re" };
  if (kind === null || !(MESSAGE_KINDS as readonly string[]).includes(kind)) return { error: `kind must be one of ${MESSAGE_KINDS.join(", ")}` };
  const cls = fields.get("class");
  if (cls !== undefined && !(ANSWER_CLASSES as readonly string[]).includes(cls)) return { error: `class must be one of ${ANSWER_CLASSES.join(", ")}` };
  const body = (fm[2] ?? "").trim();
  if (body.length === 0) return { error: "the message has no body" };
  return {
    repo, path, at, from, to, re, kind: kind as MessageKind,
    class: cls === undefined ? null : (cls as Message["class"]),
    body: body.length <= MAX_BODY ? body : `${body.slice(0, MAX_BODY)}\n[clipped]`,
  };
}

/** The file text for one message. */
export function formatMessage(m: { from: string; to: string; re: string; kind: MessageKind; class?: Message["class"]; body: string }): string {
  const cls = m.class ? `class: ${m.class}\n` : "";
  return `---\nfrom: ${m.from}\nto: ${m.to}\nre: ${m.re}\nkind: ${m.kind}\n${cls}---\n\n${m.body.trim()}\n`;
}

/** messages/<UTC timestamp>-<slug>.md for a time and a free-text title. */
export function messagePath(at: Date, title: string): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "message";
  return `messages/${stamp}-${slug}.md`;
}
