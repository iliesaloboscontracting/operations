const FIELDS = [
  "name", "client", "jobNo", "address", "status", "startDate", "dayStart", "dayEnd",
  "nightStart", "nightEnd", "unpaidBreakMinutes", "notes", "archived",
  "contractValue", "contractValueNotes",
] as const;

const NUMERIC_FIELDS = new Set(["unpaidBreakMinutes", "contractValue"]);

export function pickProject(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (k in body) {
      const v = body[k];
      if (NUMERIC_FIELDS.has(k)) {
        data[k] = v === "" || v === null || v === undefined ? null : Number(v);
      } else {
        data[k] = typeof v === "string" && v.trim() === "" && k !== "name" && k !== "status" ? null : v;
      }
    }
  }
  if (data.status === null) delete data.status;
  return data;
}