// Accounts stage 2 - payroll rules, plain code (docs/accounts/STAGE2-DESIGN.md). No database here:
// ./store.ts loads. Hours only - never a rate, an amount, bank details or a TFN. Draft defaults for Ilies /
// Victoria are marked "Draft".
import { tierFor, type RateTier } from "../labourCost";
import { assertNoMoney } from "../moneyGuard";

export type Group = "EMPLOYEE" | "ABN" | "HIRE";
export type DayState = "APPROVED" | "FLAGGED" | "CHANGED" | "NOT_APPROVED" | "NO_SUPERVISOR";

export type PayLine = {
  attendanceId: string; date: string; personKey: string; personName: string; resourceId: string | null; company: string | null;
  group: Group; engagementSet: boolean; jobId: string | null; shift: "DAY" | "NIGHT"; site: string; point: boolean;
  in: string; out: string | null; hours: number | null; status: string; tile: string | null; // labour hire: the board tile it fills
  gps: { lat: number; lng: number; accuracyM: number | null } | null; gpsStatus: string | null;
};
export type ApprovalSnapshotLine = { attendanceId: string; name: string; company: string | null; in: string; out: string | null; hours: number | null; flag?: string };

// "hire:<name>|<company>" for a worker with no register record; the resource id otherwise.
export const personKeyOf = (resourceId: string | null, name: string, company: string | null) =>
  resourceId ?? `hire:${name.trim().toLowerCase().replace(/\s+/g, " ")}|${(company ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;

export const groupOf = (resourceId: string | null, engagement: string | null): Group => (!resourceId ? "HIRE" : engagement === "ABN" ? "ABN" : "EMPLOYEE");

// A person's day against the supervisor's latest approval of that job and day. Sign-in points (office, yard,
// truck) have no job and no supervisor (Draft: they go straight to the Manager and Victoria).
export function dayState(line: Pick<PayLine, "attendanceId" | "jobId" | "hours" | "in" | "out">, latest: ApprovalSnapshotLine[] | null): DayState {
  if (!line.jobId) return "NO_SUPERVISOR";
  const s = latest?.find((x) => x.attendanceId === line.attendanceId);
  if (!s) return "NOT_APPROVED";
  if (s.hours !== line.hours || s.in !== line.in || s.out !== line.out) return "CHANGED"; // the office changed it since
  return s.flag ? "FLAGGED" : "APPROVED";
}

// ---------- pay items (Draft: the names must match the pay items in Lobos's Xero) ----------

export const PAY_ITEMS: Record<RateTier, string> = { ORDINARY: "Ordinary Hours", NIGHT: "Night Hours", SATURDAY: "Saturday Hours", SUNDAY: "Sunday Hours" };
export const payTierOf = (l: Pick<PayLine, "date" | "shift" | "point">): RateTier => tierFor(l.date, l.point ? "DAY" : l.shift);

// ---------- Victoria's approval ----------

// Staff on the Manager timesheet: only once the Manager has locked the week (the hours can't change under
// her). Hire / subcontract workers aren't on that timesheet: once the week has ended. (Draft)
export function canAccountsApprove(group: Group, managerLocked: boolean, weekEnded: boolean): string | null {
  if (!weekEnded) return "The week hasn't finished yet.";
  if (group !== "HIRE" && !managerLocked) return "The Manager hasn't approved and locked this week's timesheet yet.";
  return null;
}

// Who goes in the pay-run file: employees (or engagement not set yet - flagged) that Victoria approved.
// ABN workers invoice (stage 4) and labour hire is paid on the agency's invoice. (Draft)
export const inPayRun = (group: Group, reviewStatus: string | null) => group === "EMPLOYEE" && reviewStatus === "APPROVED";

// ---------- files (hours only) ----------

export const TRAVEL_HOOK = "rule to be agreed"; // driver / passenger and regional rule - waits on a session with Victoria
export const EXPORT_COLUMNS = ["Employee", "Email", "Earnings Rate", "Date", "Hours", "Site", "Travel"] as const; // Draft: match Xero's import template
export const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; // no spreadsheet formulas
};
export const toCsv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const q4 = (n: number) => Math.round(n * 4) / 4;

// One row per person, pay item and day - hours summed (several sign-ins in a day add up).
export function payRunRows(lines: PayLine[], approved: Set<string>, emails: Map<string, string | null>): (string | number | null)[][] {
  const acc = new Map<string, { name: string; email: string | null; item: string; date: string; hours: number; sites: Set<string> }>();
  for (const l of lines) {
    if (!approved.has(l.personKey) || l.hours == null || l.hours <= 0) continue;
    const item = PAY_ITEMS[payTierOf(l)];
    const k = `${l.personKey}|${item}|${l.date}`;
    const v = acc.get(k) ?? { name: l.personName, email: emails.get(l.personKey) ?? null, item, date: l.date, hours: 0, sites: new Set<string>() };
    v.hours += l.hours; v.sites.add(l.site);
    acc.set(k, v);
  }
  const rows = [...acc.values()].sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date) || a.item.localeCompare(b.item));
  return [[...EXPORT_COLUMNS], ...rows.map((v) => [v.name, v.email, v.item, v.date, q4(v.hours), [...v.sites].join(" / "), TRAVEL_HOOK])];
}

export type SummaryPerson = { personKey: string; name: string; group: Group; company: string | null; hours: number; byItem: Record<string, number>; days: number; review: string | null };
export function summarise(lines: PayLine[], reviews: Map<string, string>): { people: SummaryPerson[]; byItem: Record<string, number>; bySite: Record<string, number>; byAgency: Record<string, number>; total: number } {
  const people = new Map<string, SummaryPerson>();
  const byItem: Record<string, number> = {}, bySite: Record<string, number> = {}, byAgency: Record<string, number> = {};
  let total = 0;
  for (const l of lines) {
    const h = l.hours ?? 0;
    const item = PAY_ITEMS[payTierOf(l)];
    const p = people.get(l.personKey) ?? { personKey: l.personKey, name: l.personName, group: l.group, company: l.company, hours: 0, byItem: {}, days: 0, review: reviews.get(l.personKey) ?? null };
    p.hours += h; p.byItem[item] = (p.byItem[item] ?? 0) + h;
    people.set(l.personKey, p);
    byItem[item] = (byItem[item] ?? 0) + h; bySite[l.site] = (bySite[l.site] ?? 0) + h;
    if (l.group === "HIRE") byAgency[l.company ?? "Unknown agency"] = (byAgency[l.company ?? "Unknown agency"] ?? 0) + h;
    total += h;
  }
  for (const p of people.values()) p.days = new Set(lines.filter((l) => l.personKey === p.personKey && (l.hours ?? 0) > 0).map((l) => l.date)).size;
  const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, q4(v)]));
  return {
    people: [...people.values()].map((p) => ({ ...p, hours: q4(p.hours), byItem: round(p.byItem) })).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    byItem: round(byItem), bySite: round(bySite), byAgency: round(byAgency), total: q4(total),
  };
}

// Nothing money-like in any export or screen built here.
export const fileIsSafe = (csv: string) => assertNoMoney(csv) && !/\b(rate \$|bsb|account number|tfn|tax file|aba)\b/i.test(csv);

// ---------- GPS at sign-in ----------

export const GPS_STATUSES = ["OK", "DENIED", "UNAVAILABLE", "TIMEOUT"] as const;
// What the phone sent with a sign-in -> what's stored. Bad numbers are dropped; never blocks a sign-in.
export function parseGps(v: unknown): { gpsLat: number | null; gpsLng: number | null; gpsAccuracyM: number | null; gpsStatus: string | null } {
  const none = { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsStatus: null };
  if (!v || typeof v !== "object") return none;
  const g = v as Record<string, unknown>;
  const status = typeof g.status === "string" && (GPS_STATUSES as readonly string[]).includes(g.status) ? g.status : null;
  const lat = Number(g.lat), lng = Number(g.lng), acc = Number(g.accuracy);
  if (status === "OK" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { gpsLat: Math.round(lat * 1e6) / 1e6, gpsLng: Math.round(lng * 1e6) / 1e6, gpsAccuracyM: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null, gpsStatus: "OK" };
  }
  return { ...none, gpsStatus: status && status !== "OK" ? status : status === "OK" ? "UNAVAILABLE" : null };
}
