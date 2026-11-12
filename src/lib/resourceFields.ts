import { parseLimitInput } from "./dayLimit/rules";

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
  "gstRegistered", // Accounts stage 4: ABN worker GST-registered (set on Accounts; Admin-only here)
] as const;

// Days-a-week limit (12 Nov 2026, lib/dayLimit): set or changed by an Admin only, like the pay fields above - but
// Managers see it (they plan the board), so it isn't one of them. VIEWER and below never get it (toPublicResource).
export const ADMIN_SET_FIELDS = ["maxDaysPerWeek"] as const;

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
  ...ADMIN_SET_FIELDS,
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
      if (key === "maxDaysPerWeek") {
        const p = parseLimitInput(v);
        data[key] = "value" in p ? p.value : v; // a bad value is refused before this (dayLimitInputError)
      } else if (NUMERIC_FIELDS.has(key)) {
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

// The days-a-week limit in a body: null when fine (or not there), else the words to refuse it with.
export function dayLimitInputError(body: Record<string, unknown>): string | null {
  if (!("maxDaysPerWeek" in body)) return null;
  const p = parseLimitInput(body.maxDaysPerWeek);
  return "error" in p ? p.error : null;
}
