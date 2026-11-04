// A Tools write from a login that only sees the register with amounts taken out - the coordinator (2 Nov 2026) and the
// yard computer (Ilies, 4 Nov 2026), lib/coordinatorView.ts STRIPPED_ROLES. The Hire rule, reused
// (lib/coordinatorHire.ts strippedTextWrite), on every text field: sent back exactly as shown -> dropped (unchanged), so
// a normal save never overwrites a Manager's "Repair quote $450" with "(amount not recorded)"; changed while the stored
// value holds an amount they can't see -> 409; new text with an amount -> 400. "Shown" is the notes treatment that
// viewJson / withoutAmounts give every string. No server imports; `npm test` (yardRole.test.ts).
import { strippedTextWrite } from "./coordinatorHire";
import { TOOL_TEXT_FIELDS } from "./pickTool";

export const STRIPPED_ROLES: readonly string[] = ["COORDINATOR", "YARD"];
// A fault's free text a PATCH can change (api/tool-issues/[id]); its description is set once, when reported.
export const ISSUE_TEXT_FIELDS: readonly string[] = ["swapRef", "resolution"];
export const seesAmountsStripped = (role: string | null | undefined) => !!role && STRIPPED_ROLES.includes(role);

// `data` (as lib/pickTool.ts picked it, or a fault's fields) is changed in place: unchanged fields are removed.
export function keepHiddenAmounts(
  data: Record<string, unknown>, existing: Record<string, unknown>, fields: readonly string[] = TOOL_TEXT_FIELDS,
): { error: string; status: number } | null {
  for (const k of fields) {
    if (!(k in data)) continue;
    const w = strippedTextWrite("notes", data[k], { stored: existing[k] ?? null });
    if (w === "unchanged") delete data[k];
    else if (w !== "ok") return w;
  }
  return null;
}
