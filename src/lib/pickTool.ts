const FIELDS = ["tag", "name", "model", "condition", "heldBy", "lastSeen", "notes"] as const;
const REQUIRED = new Set(["tag", "name", "condition", "heldBy"]);

export function pickTool(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (k in body) {
      const v = body[k];
      data[k] = typeof v === "string" && v.trim() === "" && !REQUIRED.has(k) ? null : v;
    }
  }
  return data;
}