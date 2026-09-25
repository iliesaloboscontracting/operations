const FIELDS = [
  "name", "client", "jobNo", "address", "status", "startDate", "dayStart", "dayEnd",
  "nightStart", "nightEnd", "notes", "archived",
] as const;

export function pickProject(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (k in body) {
      const v = body[k];
      data[k] = typeof v === "string" && v.trim() === "" && k !== "name" && k !== "status" ? null : v;
    }
  }
  if (data.status === null) delete data.status;
  return data;
}