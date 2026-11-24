// The Toolboxes page's "last check" line (TT-001, Ilies approved 25 Nov 2026): a tick-list check (lib/toolboxTick.ts)
// must not read like a photo check. The method comes from the stored ToolboxCheck result - `method: "TICK"`, or any line
// marked `how: "tick"` - and when the latest check was ticked, the page also says when the box last had a photo check.
// Plain code, no database.

export type CheckMethod = "TICK" | "PHOTO";

export type LastCheck = {
  id: string;
  createdAt: Date | string;
  checkedBy: string | null;
  method: CheckMethod;
  missing?: number;
  foreign?: number;
  lastPhotoCheckAt?: Date | string | null; // only when the latest check was ticked; null = never a photo check
};

// The method of a stored check result (the ToolboxCheck.result JSON, already parsed).
export function checkMethod(result: unknown): CheckMethod {
  if (!result || typeof result !== "object") return "PHOTO";
  const r = result as Record<string, unknown>;
  if (r.method === "TICK") return "TICK";
  const lines = ["present", "presentUnconfirmed", "missing", "foreign"].flatMap((k) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []));
  return lines.some((l) => !!l && typeof l === "object" && (l as Record<string, unknown>).how === "tick") ? "TICK" : "PHOTO";
}

// The latest check of a toolbox -> its "last check" summary. `lastPhotoCheckAt` = the box's newest photo check (any).
export function lastCheckOf(
  last: { id: string; createdAt: Date | string; checkedBy: string | null; result: string } | null | undefined,
  lastPhotoCheckAt: Date | string | null = null,
): LastCheck | null {
  if (!last) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(last.result);
  } catch {
    parsed = null;
  }
  const method = checkMethod(parsed);
  const r = (parsed && typeof parsed === "object" ? parsed : null) as { missing?: unknown[]; foreign?: unknown[] } | null;
  const summary = r ? { missing: Array.isArray(r.missing) ? r.missing.length : 0, foreign: Array.isArray(r.foreign) ? r.foreign.length : 0 } : {};
  return {
    id: last.id,
    createdAt: last.createdAt,
    checkedBy: last.checkedBy,
    method,
    ...summary,
    ...(method === "TICK" ? { lastPhotoCheckAt: lastPhotoCheckAt ?? null } : {}),
  };
}

const day = (d: Date | string) => new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" });

// "last checked 25 Nov (ticked) by Pol — 1 missing, 0 from other boxes · last photo check: 18 Nov"
export function lastCheckText(last: LastCheck | null): string {
  if (!last) return "never checked";
  const how = last.method === "TICK" ? " (ticked)" : " (photo)";
  const by = last.checkedBy ? ` by ${last.checkedBy}` : "";
  const found = last.missing || last.foreign ? ` — ${last.missing ?? 0} missing, ${last.foreign ?? 0} from other boxes` : " — all good";
  const photo = last.method === "TICK" ? ` · last photo check: ${last.lastPhotoCheckAt ? day(last.lastPhotoCheckAt) : "never"}` : "";
  return `last checked ${day(last.createdAt)}${how}${by}${found}${photo}`;
}
