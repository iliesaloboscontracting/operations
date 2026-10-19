// Fields a person can set on a tool. toolboxId is deliberately not here: a
// tool only changes toolbox through lib/toolMoves.ts, so every move is logged.
const FIELDS = [
  "tag", "name", "model", "condition", "heldBy", "lastSeen", "notes",
  "brand", "serialNumber", "itemNo", "manufactured", "conditionNotes", "ownership", "fleetRef",
] as const;
const REQUIRED = new Set(["tag", "name", "condition", "heldBy", "ownership"]);

export const TOOL_CONDITIONS = ["New", "Good", "Needs repair", "Missing", "Swapped out"] as const;
export const TOOL_OWNERSHIP = ["OWNED", "HILTI_FLEET", "HIRED"] as const;
export const OWNERSHIP_LABEL: Record<string, string> = { OWNED: "Lobos owned", HILTI_FLEET: "Hilti fleet", HIRED: "Hired" };

export function pickTool(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (k in body) {
      const v = body[k];
      data[k] = typeof v === "string" && v.trim() === "" && !REQUIRED.has(k) ? null : typeof v === "string" ? v.trim() : v;
    }
  }
  return data;
}

// Returns an error message, or null when the fields are fine to save.
export function toolFieldError(data: Record<string, unknown>): string | null {
  if ("condition" in data && !(TOOL_CONDITIONS as readonly unknown[]).includes(data.condition)) return "Unknown condition.";
  if ("ownership" in data && !(TOOL_OWNERSHIP as readonly unknown[]).includes(data.ownership)) return "Ownership must be Lobos owned, Hilti fleet or Hired.";
  return null;
}
