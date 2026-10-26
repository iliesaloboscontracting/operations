// ABN worker invoices vs approved hours (Accounts stage 4, docs/accounts/STAGE4-DESIGN.md) - the pure rules:
// whose invoice it is, the day-by-day comparison, the GST flag and the ABN checksum. Hours only.

export const HOURS_TOLERANCE = 0.25; // Draft - for Ilies / Victoria

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

// The ABN workers an invoice's supplier names: every word of the person's register name appears as a whole
// word in the supplier ("Cem" in "Cem Dogay Pty Ltd"). Only people marked ABN, only active ones.
export function abnWorkersNamed(supplier: string | null, people: { id: string; name: string; engagement: string | null; active?: boolean }[]) {
  if (!supplier) return [];
  const have = new Set(words(supplier));
  return people.filter((p) => p.engagement === "ABN" && p.active !== false && words(p.name).length > 0 && words(p.name).every((w) => have.has(w)));
}

export type DayHours = { date: string; hours: number };
export type ApprovedDay = { date: string; signed: number; approved: number };
export type DayFlag = "OK" | "OVER" | "UNDER" | "NOT_APPROVED" | "NOT_INVOICED";
export type DayRow = { date: string; invoiced: number | null; signed: number; approved: number; diff: number | null; flag: DayFlag };
export type HoursCheck = { mode: "DAYS" | "TOTAL" | "NO_HOURS"; rows: DayRow[]; invoicedTotal: number | null; approvedTotal: number; signedTotal: number; diff: number | null; flags: string[] };

const q = (n: number) => Math.round(n * 100) / 100;

// Day by day where the invoice lists days; else its total hours against the period; else nothing to compare.
export function compareHours(invoiceDays: DayHours[] | null, hoursTotal: number | null, approved: ApprovedDay[], tol = HOURS_TOLERANCE): HoursCheck {
  const byDate = new Map(approved.map((a) => [a.date, a]));
  const approvedTotal = q(approved.reduce((n, a) => n + a.approved, 0));
  const signedTotal = q(approved.reduce((n, a) => n + a.signed, 0));
  const days = (invoiceDays ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isFinite(d.hours));
  if (days.length) {
    const inv = new Map<string, number>();
    for (const d of days) inv.set(d.date, q((inv.get(d.date) ?? 0) + d.hours));
    const dates = [...new Set([...inv.keys(), ...byDate.keys()])].sort();
    const rows = dates.map((date): DayRow => {
      const a = byDate.get(date) ?? { signed: 0, approved: 0 };
      const invoiced = inv.get(date) ?? null;
      if (invoiced == null) return { date, invoiced: null, signed: a.signed, approved: a.approved, diff: null, flag: a.approved > 0 ? "NOT_INVOICED" : "OK" };
      const diff = q(invoiced - a.approved);
      const flag: DayFlag = a.approved === 0 && invoiced > 0 ? "NOT_APPROVED" : diff > tol ? "OVER" : diff < -tol ? "UNDER" : "OK";
      return { date, invoiced, signed: a.signed, approved: a.approved, diff, flag };
    });
    const invoicedTotal = q([...inv.values()].reduce((n, v) => n + v, 0));
    const count = (f: DayFlag) => rows.filter((r) => r.flag === f).length;
    const flags = [
      count("OVER") && `${count("OVER")} day(s) invoiced over the approved hours`,
      count("NOT_APPROVED") && `${count("NOT_APPROVED")} day(s) invoiced with no approved hours`,
      count("UNDER") && `${count("UNDER")} day(s) invoiced under the approved hours`,
    ].filter((x): x is string => !!x);
    return { mode: "DAYS", rows, invoicedTotal, approvedTotal, signedTotal, diff: q(invoicedTotal - approvedTotal), flags };
  }
  const rows = approved.filter((a) => a.signed || a.approved).map((a): DayRow => ({ date: a.date, invoiced: null, signed: a.signed, approved: a.approved, diff: null, flag: "OK" }));
  if (hoursTotal != null && Number.isFinite(hoursTotal)) {
    const diff = q(hoursTotal - approvedTotal);
    return { mode: "TOTAL", rows, invoicedTotal: q(hoursTotal), approvedTotal, signedTotal, diff, flags: diff > tol ? [`Invoices ${diff} h more than approved for the period`] : diff < -tol ? [`Invoices ${-diff} h less than approved for the period`] : [] };
  }
  return { mode: "NO_HOURS", rows, invoicedTotal: null, approvedTotal, signedTotal, diff: null, flags: ["Hours aren't shown on the invoice - compare with the approved hours by hand"] };
}

export type GstFlag = "CHARGED_NOT_REGISTERED" | "REGISTERED_NOT_CHARGED" | "REGISTRATION_UNKNOWN";
export const GST_FLAG_TEXT: Record<GstFlag, string> = {
  CHARGED_NOT_REGISTERED: "Charges GST, but isn't recorded as GST-registered",
  REGISTERED_NOT_CHARGED: "Recorded as GST-registered, but no GST charged",
  REGISTRATION_UNKNOWN: "Charges GST - GST registration not recorded yet",
};
export function gstFlag(gst: number | null, registered: boolean | null): GstFlag | null {
  const charged = gst != null && gst > 0.005;
  if (registered === false && charged) return "CHARGED_NOT_REGISTERED";
  if (registered === true && !charged) return "REGISTERED_NOT_CHARGED";
  if (registered == null && charged) return "REGISTRATION_UNKNOWN";
  return null;
}

// The ATO's ABN check: subtract 1 from the first digit, weight the 11 digits, the sum divides by 89.
const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
export function abnLooksValid(abn: string | null): boolean | null {
  if (!abn || !abn.trim()) return null;
  const d = abn.replace(/\s+/g, "");
  if (!/^\d{11}$/.test(d)) return false;
  const n = d.split("").map(Number);
  n[0] -= 1;
  return n.reduce((s, x, i) => s + x * WEIGHTS[i], 0) % 89 === 0;
}

// The Monday-starting weeks an invoice period covers (to read each week's payroll).
export function weeksCovering(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (let i = 0; i < 26; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > to) break;
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

// Reads the JSON the inbox stored ("[{date, hours}]"), dropping anything malformed.
export function parseDays(json: string | null): DayHours[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    const out = v.map((x) => ({ date: String(x?.date ?? ""), hours: Number(x?.hours) })).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.hours) && x.hours >= 0 && x.hours <= 24);
    return out.length ? out : null;
  } catch { return null; }
}
