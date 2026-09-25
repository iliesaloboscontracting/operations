const FIELDS = ["date", "mechanic", "invoiceNo", "work", "amountExGst", "gst", "total", "odometer", "notes"] as const;
const NUMERIC = new Set(["amountExGst", "gst", "total", "odometer"]);

export function pickServiceRecord(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (NUMERIC.has(k)) {
      data[k] = v === "" || v === null || v === undefined ? null : Number(v);
    } else {
      data[k] = typeof v === "string" && v.trim() === "" && k !== "date" ? null : v;
    }
  }
  return data;
}
