// Individual pay rate - sensitive personal compensation data. Gated to Admin
// only, both for reading (see /api/resources GET) and writing (see
// /api/resources/[id] PATCH) - kept as its own list so both call sites check
// the same set.
export const PAY_RATE_FIELDS = [
  "payRateBasis",
  "annualSalary",
  "ordinaryRate",
  "nightRate",
  "travelRate",
  "regionalDayRate",
  "regionalNightRate",
  "saturdayRate",
  "sundayRate",
  "payRateConfirmed",
  "payRateNotes",
  "engagement", // Accounts stage 2: EMPLOYEE | ABN - who goes in the pay run (Admin, with the pay details)
] as const;

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
  "onHireDate",
  "offHireDate",
  "rate",
  "dailyRateExGst",
  "hireRate",
  "hireRateUnit",
  "hireProjectId",
  "hireRef",
  "hireDeliveryCost",
  "hireCollectionCost",
  "hireStatus",
  "hireSource",
  "active",
  ...PAY_RATE_FIELDS,
] as const;

const NUMERIC_FIELDS = new Set([
  "dailyRateExGst",
  "annualSalary",
  "ordinaryRate",
  "nightRate",
  "travelRate",
  "regionalDayRate",
  "regionalNightRate",
  "saturdayRate",
  "sundayRate",
  "hireRate",
  "hireDeliveryCost",
  "hireCollectionCost",
]);

export function pickResourceData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of RESOURCE_FIELDS) {
    if (key in body) {
      const v = body[key];
      if (NUMERIC_FIELDS.has(key)) {
        data[key] = v === "" || v === null || v === undefined ? null : Number(v);
      } else if (key === "payRateConfirmed") {
        data[key] = v === true || v === "true";
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
