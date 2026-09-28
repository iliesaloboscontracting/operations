// Single per-allocation costing function (Phase 3) - extracted from
// /api/tracking's inline loop so the live Tracking view and the day-close
// ledger writer (freezeDayCosts) run the exact same rules instead of two
// copies drifting apart.
import type { Resource } from "@prisma/client";
import { tierFor, rateAndCost, hireCost, hoursBetween, type CostStatus } from "./labourCost";

export type CostType = "LABOUR" | "HIRE_LABOUR" | "PLANT" | "ATTACHMENT" | "VEHICLE" | "HIRE";

export interface AllocationCostResult {
  costType: CostType | null; // null only for a resource type that never carries a cost at all (there is none today - kept for a future one)
  amount: number | null;
  status: CostStatus | null;
  rateUsed: number | null;
  hours: number | null;
}

type CostableResource = Pick<
  Resource,
  | "type" | "category" | "name" | "dailyRateExGst"
  | "payRateBasis" | "ordinaryRate" | "nightRate" | "saturdayRate" | "sundayRate" | "payRateConfirmed"
  | "hireRate" | "hireRateUnit"
>;

interface ShiftWindow {
  unpaidBreakMinutes: number | null;
  dayStart: string | null;
  dayEnd: string | null;
  nightStart: string | null;
  nightEnd: string | null;
}

export function costAllocation(
  dateStr: string,
  shift: "DAY" | "NIGHT",
  jobStartTime: string | null,
  jobEndTime: string | null,
  project: ShiftWindow,
  resource: CostableResource
): AllocationCostResult {
  const breakHours = (project.unpaidBreakMinutes ?? 0) / 60; // D1
  const grossHours =
    hoursBetween(jobStartTime, jobEndTime) ??
    hoursBetween(shift === "NIGHT" ? project.nightStart : project.dayStart, shift === "NIGHT" ? project.nightEnd : project.dayEnd);
  const hours = grossHours != null ? Math.max(0, Math.round((grossHours - breakHours) * 100) / 100) : null;

  if (resource.type === "PERSONNEL") {
    const tier = tierFor(dateStr, shift);
    const { rateUsed, cost, status } = rateAndCost(resource, tier, hours);
    return { costType: "LABOUR", amount: cost, status, rateUsed, hours };
  }

  // Hired labour (D3): costed live from hireRate, kept as its own cost type
  // so it's never folded into the flat "HIRE" dailyRateExGst bucket below -
  // that bucket is reconciled against the agency's InvoicedCost, not this.
  if (resource.type === "HIRE" && resource.category === "LABOUR") {
    const { rateUsed, cost, status } = hireCost(resource, hours);
    return { costType: "HIRE_LABOUR", amount: cost, status, rateUsed, hours };
  }

  // Hired plant/vehicles (Phase 2b, 2026-09-28): also costed from the
  // numeric hireRate once one's entered, the same way hired labour is -
  // previously this fell straight to the legacy dailyRateExGst below and
  // ignored hireRate entirely. Takes priority over dailyRateExGst when
  // both are set, since hireRate is the newer, more specific figure; falls
  // through below only while hireRate hasn't been entered yet.
  if (resource.type === "HIRE" && resource.hireRate != null) {
    const { rateUsed, cost, status } = hireCost(resource, hours);
    return { costType: "HIRE", amount: cost, status, rateUsed, hours };
  }

  const costType: CostType | null =
    resource.type === "EQUIPMENT" ? "PLANT" :
    resource.type === "ATTACHMENT" ? "ATTACHMENT" :
    resource.type === "VEHICLE" ? "VEHICLE" :
    resource.type === "HIRE" ? "HIRE" :
    null;
  if (!costType) return { costType: null, amount: null, status: null, rateUsed: null, hours };
  // Phase 2b: a missing rate is RATE_MISSING, not a silent null/$0 - plant,
  // attachments, vehicles and hired items with no rate on file were
  // previously invisible to Tracking's uncosted count.
  const rate = resource.dailyRateExGst;
  if (!rate) return { costType, amount: null, status: "RATE_MISSING", rateUsed: null, hours };
  return { costType, amount: rate, status: "COSTED", rateUsed: rate, hours };
}
