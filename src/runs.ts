// The forge runs (ISSUE-00027): RUNS.md in the spec canonical is the one copy. The forge reads it
// under BOOTSTRAP's standing loop; the board's NEXT FORGE PROMPT panel reads it through /api/runs.
// A run edit is one spec publish, with no Worker deploy.
//
// Format, one section per run, in run order:
//
//   ## Run <id>: <title>
//
//   Objectives: <objective>, <objective>      ("amend-*" matches any amendment objective)
//   Done: yes | no
//
//   ```text
//   <the prompt>
//   ```

export interface ForgeRun {
  readonly run: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly done: boolean;
  readonly prompt: string;
}

const HEADING = /^## Run ([a-z0-9]+): (.+?)\s*$/;
const OBJECTIVE = /^[a-z0-9-]+\*?$/;

/** Parses RUNS.md. Returns the runs, or the first fault with its line number. */
export function parseRuns(text: string): { runs: ForgeRun[] } | { error: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const runs: ForgeRun[] = [];
  const starts = lines.flatMap((l, i) => (HEADING.test(l) ? [i] : []));
  for (const [n, start] of starts.entries()) {
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start + 1, end);
    const m = (lines[start] ?? "").match(HEADING);
    const at = `line ${start + 1}`;
    const field = (name: string): string | undefined => body.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2).trim();
    const objectives = (field("Objectives") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    if (objectives.length === 0 || !objectives.every((o) => OBJECTIVE.test(o))) return { error: `${at}: Objectives must list objective slugs` };
    const done = field("Done");
    if (done !== "yes" && done !== "no") return { error: `${at}: Done must be yes or no` };
    const open = body.findIndex((l) => l === "```text");
    const close = open < 0 ? -1 : body.findIndex((l, i) => i > open && l === "```");
    if (open < 0 || close < 0) return { error: `${at}: the prompt must sit in one fenced text block` };
    const prompt = body.slice(open + 1, close).join("\n").trim();
    if (prompt.length === 0) return { error: `${at}: the prompt is empty` };
    if (runs.some((r) => r.run === m?.[1])) return { error: `${at}: run ${m?.[1]} appears twice` };
    runs.push({ run: m?.[1] ?? "", title: `Run ${m?.[1]}: ${m?.[2]}`, objectives, done: done === "yes", prompt });
  }
  return runs.length > 0 ? { runs } : { error: "no ## Run section" };
}
