// Shared own-crew wage-costing logic, used by:
// - /api/tracking (live cost for every running job going forward)
// - the one-off historical import that backfilled 12 Aug - 26 Sep 2026 from
//   the daily allocation PDFs (script since removed; this file documents the
//   same rules so future backfills or audits stay consistent)
//
// Rate tier rule: Sunday date -> sundayRate, Saturday date -> saturdayRate,
// weekday night shift -> nightRate, weekday day shift -> ordinaryRate. A
// DAY_RATE resource always costs its flat ordinaryRate for the shift,
// regardless of tier (no Sat/Sun/night loading is captured for day-rate
// contractors). SALARY is left TBC - no reliable way to attribute an annual
// figure to a single shift without knowing the person's standard working days.
import type { Resource } from "@prisma/client";

export type RateTier = "ORDINARY" | "NIGHT" | "SATURDAY" | "SUNDAY";

type HourlyRateField = "ordinaryRate" | "nightRate" | "saturdayRate" | "sundayRate";

const RATE_FIELD: Record<RateTier, HourlyRateField> = {
  ORDINARY: "ordinaryRate",
  NIGHT: "nightRate",
  SATURDAY: "saturdayRate",
  SUNDAY: "sundayRate",
};

// Known unresolved rate outliers, excluded from cost computation (hours still
// recorded) until the real figure is confirmed. Empty since 24 Oct 2026: Chris
// Poulos's $400 turned out to be a DAY rate and is now on file as DAY_RATE.
const RATE_EXCLUDED_NAMES = new Set<string>();

// One of these per costed allocation, alongside rateUsed/cost - so an
// uncosted allocation is never silently shown as $0 (Phase 2.3, 2026-09-28).
// COSTED: a confirmed rate was applied. RATE_MISSING: no rate on file for
// this basis/tier. RATE_UNCONFIRMED: a rate exists but payRateConfirmed is
// false - still used (matches the original pay-rates import instruction to
// use whatever figure exists, labelled TBC), just flagged. EXCLUDED: a known
// unresolved outlier, salaried staff (D5), or a hired-labour item explicitly
// not costed this way. HOURS_UNKNOWN: the shift's time range didn't parse.
export type CostStatus = "COSTED" | "RATE_MISSING" | "RATE_UNCONFIRMED" | "EXCLUDED" | "HOURS_UNKNOWN";

export function tierFor(dateStr: string, shift: "DAY" | "NIGHT"): RateTier {
  const dow = new Date(dateStr + "T00:00:00").getDay();
  if (dow === 0) return "SUNDAY";
  if (dow === 6) return "SATURDAY";
  return shift === "NIGHT" ? "NIGHT" : "ORDINARY";
}

export function rateAndCost(
  resource: Pick<Resource, "name" | "payRateBasis" | "ordinaryRate" | "nightRate" | "saturdayRate" | "sundayRate" | "payRateConfirmed">,
  tier: RateTier,
  hours: number | null
): { rateUsed: number | null; cost: number | null; status: CostStatus } {
  if (RATE_EXCLUDED_NAMES.has(resource.name)) return { rateUsed: null, cost: null, status: "EXCLUDED" };
  if (resource.payRateBasis === "HOURLY") {
    if (hours == null) return { rateUsed: null, cost: null, status: "HOURS_UNKNOWN" };
    const rate = resource[RATE_FIELD[tier]];
    if (rate == null) return { rateUsed: null, cost: null, status: "RATE_MISSING" };
    const cost = Math.round(rate * hours * 100) / 100;
    return { rateUsed: rate, cost, status: resource.payRateConfirmed ? "COSTED" : "RATE_UNCONFIRMED" };
  }
  if (resource.payRateBasis === "DAY_RATE") {
    if (resource.ordinaryRate == null) return { rateUsed: null, cost: null, status: "RATE_MISSING" };
    return { rateUsed: resource.ordinaryRate, cost: resource.ordinaryRate, status: resource.payRateConfirmed ? "COSTED" : "RATE_UNCONFIRMED" };
  }
  if (resource.payRateBasis === "SALARY") return { rateUsed: null, cost: null, status: "EXCLUDED" }; // D5
  return { rateUsed: null, cost: null, status: "RATE_MISSING" };
}

// Hired labour/plant/vehicles costed live from a numeric hireRate (Phase 2.1,
// D3) - a rate on the item, estimated per allocation the same way owned
// plant is, kept separate from (and never summed with) the agency's actual
// InvoicedCost so the two can be compared, not double-counted.
export function hireCost(
  resource: Pick<Resource, "hireRate" | "hireRateUnit">,
  hours: number | null
): { rateUsed: number | null; cost: number | null; status: CostStatus } {
  if (resource.hireRate == null || !resource.hireRateUnit) return { rateUsed: null, cost: null, status: "RATE_MISSING" };
  if (resource.hireRateUnit === "DAY") {
    return { rateUsed: resource.hireRate, cost: Math.round(resource.hireRate * 100) / 100, status: "COSTED" };
  }
  if (resource.hireRateUnit === "HOUR") {
    if (hours == null) return { rateUsed: resource.hireRate, cost: null, status: "HOURS_UNKNOWN" };
    return { rateUsed: resource.hireRate, cost: Math.round(resource.hireRate * hours * 100) / 100, status: "COSTED" };
  }
  if (resource.hireRateUnit === "WEEK") {
    // Divisor confirmed with Ilies (2026-09-28, Phase 2b): 5 weekdays.
    return { rateUsed: resource.hireRate, cost: Math.round((resource.hireRate / 5) * 100) / 100, status: "COSTED" };
  }
  return { rateUsed: null, cost: null, status: "RATE_MISSING" };
}

function toMinutes(token: string): number | null {
  token = token.trim();
  let m = token.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const mer = (m[3] || "").toLowerCase();
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return h * 60 + min;
  }
  m = token.match(/^(\d{3,4})\s*(am|pm)?$/i);
  if (m) {
    const raw = m[1];
    let h: number, min: number;
    if (raw.length === 3) { h = parseInt(raw[0], 10); min = parseInt(raw.slice(1), 10); }
    else { h = parseInt(raw.slice(0, 2), 10); min = parseInt(raw.slice(2), 10); }
    const mer = (m[2] || "").toLowerCase();
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return h * 60 + min;
  }
  m = token.match(/^(\d{1,2})\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const mer = (m[2] || "").toLowerCase();
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return h * 60;
  }
  return null;
}

// Hours between two free-text times (e.g. "6:30am", "2:30pm", "630am"),
// crossing midnight if the end is earlier than the start (night shifts).
// Returns null rather than guessing when either side can't be parsed.
export function hoursBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin == null || endMin == null) return null;
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}
