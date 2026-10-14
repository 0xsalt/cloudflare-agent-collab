// Open ask: view-decisions. Replace this stub; the check is checks/view-decisions.test.ts. SPEC.md "Ask: view-decisions".
// A built view sets built = true and renders api's series-decisions into root. It only reads: the
// control that decides sits on the arena board, never in a view.

export const ask = "view-decisions";
export const series = "series-decisions";
export const built = false;

export function render(_root, _data, _doc) {
  throw new Error(ask + " is an open ask");
}
