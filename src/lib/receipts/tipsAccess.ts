// The coordinator on /receipts (Ilies approved 25 Nov 2026: "See and check, with $" and "Tip dockets only"): Alex sees
// and checks TIP dockets - the photo, what was read (tip site, weight, rego, job, asbestos, printed price), confirm /
// correct / move to the right job / set aside, the batch "None of this batch is asbestos" - plus the tip rates
// (read-only), the tip Mismatches and the per-job tip indicators. Never a FUEL receipt, an odometer reading, a PURCHASE,
// an own-money (reimbursement) receipt, or the truck / fuel indicators. Starting a batch upload stays Manager+.
// Managers and Admins are unchanged (tipsOnly false). Plain rules - no server imports - so lib/auth.ts, the routes, the
// stores and `npm test` (tipsAccess.test.ts) read the same ones.
import { coordinatorOr, rankAtLeast } from "../roles";

// Who opens /receipts at all: Manager+ (as guard("MANAGER") always did) and the coordinator - never VIEWER, TIMESHEETS,
// ACCOUNTS, DIRECTOR or YARD, and never a role the code doesn't know (rankAtLeast fails closed).
export const mayReadTipDockets = (role: string) => coordinatorOr(role, "MANAGER");
// Tip dockets only: everyone allowed in who isn't Manager+ (today the coordinator alone).
export const tipsOnlyFor = (role: string) => mayReadTipDockets(role) && !rankAtLeast(role, "MANAGER");

// The list filters as the store applies them. For the coordinator: kind is TIP whatever was asked for, and the truck
// filter is dropped (trucks are the fuel side).
export type ListFilters = { day?: string; jobId?: string; vehicleId?: string; person?: string; kind?: string; asbestos?: string; check?: string };
export function filtersFor<T extends ListFilters>(f: T, tipsOnly: boolean): T {
  if (!tipsOnly) return f;
  const { vehicleId: _v, ...rest } = f;
  return { ...rest, kind: "TIP" } as T;
}

// A receipt action (confirm, correct, set aside, read again, add a docket) on one record: for the coordinator only a
// TIP receipt that isn't own money - never an odometer reading, FUEL or PURCHASE. Refused as "not found" (404).
export const tipsOnlyMayAct = (r: { isOdometer: boolean; kind: string | null; ownMoney: boolean | null }) =>
  !r.isOdometer && r.kind === "TIP" && r.ownMoney !== true;

// A photo: for the coordinator only one on a TIP receipt that isn't own money (never an odometer photo, never one not on
// a receipt yet).
export const tipsOnlyMayViewPhoto = (p: { odometerReadingId: string | null; receipt: { kind: string; ownMoney: boolean } | null }) =>
  !p.odometerReadingId && !!p.receipt && p.receipt.kind === "TIP" && !p.receipt.ownMoney;

// GET /api/receipts?indicators=1: the coordinator gets the per-job tip indicators only - never the trucks (km, fuel,
// L/100 km), and a single truck's (vehicleId) is refused.
export type IndicatorAsk = { allowed: true; jobs: boolean; trucks: boolean; vehicleId: string | null } | { allowed: false };
export function indicatorsFor(tipsOnly: boolean, vehicleId: string | null | undefined): IndicatorAsk {
  if (tipsOnly) return vehicleId ? { allowed: false } : { allowed: true, jobs: true, trucks: false, vehicleId: null };
  return vehicleId ? { allowed: true, jobs: false, trucks: true, vehicleId } : { allowed: true, jobs: true, trucks: true, vehicleId: null };
}
