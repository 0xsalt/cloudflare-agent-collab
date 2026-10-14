// The admission scope check: a candidate changes exactly its ask's file (CONTRACT.md, "What a
// candidate may change"). A human's approval of a red record waives named extra paths for one
// ruling (ISSUE-00021); a waiver never stands in for the ask file itself.

export interface ScopeJudgement {
  readonly result: "pass" | "fail";
  readonly detail: string;
  /** Changed paths that are neither the ask file nor waived. */
  readonly outside: string[];
}

export function judgeScope(changed: readonly string[], askFile: string | undefined, waived: readonly string[]): ScopeJudgement {
  if (changed.length === 0) return { result: "fail", detail: "no change from base", outside: [] };
  const outside = changed.filter((p) => p !== askFile && !waived.includes(p));
  if (outside.length > 0) return { result: "fail", detail: `changes outside ${askFile}: ${outside.join(", ")}`, outside };
  if (askFile === undefined || !changed.includes(askFile)) return { result: "fail", detail: `a waiver covers extra paths only; ${askFile} is unchanged`, outside };
  const used = changed.filter((p) => waived.includes(p));
  return { result: "pass", detail: used.length > 0 ? `changes ${askFile} and waived ${used.join(", ")}` : `changes only ${askFile}`, outside };
}
