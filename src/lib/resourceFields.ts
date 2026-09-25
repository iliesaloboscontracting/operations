// Fields a client may set on a Resource via POST/PATCH.
export const RESOURCE_FIELDS = [
  "name",
  "type",
  "category",
  "role",
  "identifier",
  "status",
  "detail",
  "serviceDue",
  "loadSize",
  "ownership",
  "payClass",
  "phone",
  "email",
  "tickets",
  "notes",
  "agency",
  "hireStart",
  "hireEnd",
  "rate",
  "dailyRateExGst",
  "active",
] as const;

export function pickResourceData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of RESOURCE_FIELDS) {
    if (key in body) {
      const v = body[key];
      if (key === "dailyRateExGst") {
        data[key] = v === "" || v === null || v === undefined ? null : Number(v);
      } else {
        data[key] = typeof v === "string" && v.trim() === "" && key !== "name" ? null : v;
      }
    }
  }
  // Non-nullable columns keep their defaults if blanked
  for (const key of ["status", "ownership", "type"]) {
    if (data[key] === null) delete data[key];
  }
  return data;
}
