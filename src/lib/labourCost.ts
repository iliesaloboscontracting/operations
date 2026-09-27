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

// Chris Poulos (Proground Solutions): ordinaryRate on file is $400/hr, ~8x
// every other ABN contractor in the system, and was already self-flagged as
// an unresolved outlier when imported from the pay-rates spreadsheet (see his
// payRateNotes). Excluded from cost computation - hours still recorded -
// until the real figure is confirmed. Remove this once his rate is fixed.
const RATE_EXCLUDED_NAMES = new Set(["Chris"]);

export function tierFor(dateStr: string, shift: "DAY" | "NIGHT"): RateTier {
  const dow = new Date(dateStr + "T00:00:00").getDay();
  if (dow === 0) return "SUNDAY";
  if (dow === 6) return "SATURDAY";
  return shift === "NIGHT" ? "NIGHT" : "ORDINARY";
}

export function rateAndCost(
  resource: Pick<Resource, "name" | "payRateBasis" | "ordinaryRate" | "nightRate" | "saturdayRate" | "sundayRate">,
  tier: RateTier,
  hours: number | null
): { rateUsed: number | null; cost: number | null } {
  if (RATE_EXCLUDED_NAMES.has(resource.name)) return { rateUsed: null, cost: null };
  if (resource.payRateBasis === "HOURLY") {
    const rate = resource[RATE_FIELD[tier]];
    if (rate == null) return { rateUsed: null, cost: null };
    return { rateUsed: rate, cost: hours != null ? Math.round(rate * hours * 100) / 100 : null };
  }
  if (resource.payRateBasis === "DAY_RATE") {
    if (resource.ordinaryRate == null) return { rateUsed: null, cost: null };
    return { rateUsed: resource.ordinaryRate, cost: resource.ordinaryRate };
  }
  return { rateUsed: null, cost: null };
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
