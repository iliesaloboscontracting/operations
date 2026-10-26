// On-costs (Accounts stage 3, docs/accounts/STAGE3-DESIGN.md) - the pure maths. The base is Tracking's own
// crew labour (hours x pay rate), reused; on top go the on-cost lines an Admin entered with an effective date.
// No percentage lives in code: a line with no rate in force is "not set" (null), never guessed.
//
// Victoria's method (Lobos_Labour_Cost_by_Site.xlsx, "Parameters"): super on paid, employees only (ABN: none);
// workers comp and payroll tax on paid + super, everyone; payroll tax flat. The bases and who a line applies
// to are part of each rate row, so a different method is a setting, not a code change.

export type Base = "PAID" | "PAID_PLUS_SUPER";
export type AppliesTo = "EMPLOYEE" | "ALL";
export type ThresholdRule = "FLAT" | "ABOVE_THRESHOLD";

export type RateRow = {
  id?: string; line: string; label: string; percent: number; base: Base; appliesTo: AppliesTo;
  thresholdRule?: ThresholdRule | null; thresholdAnnual?: number | null; effectiveFrom: string; retiredAt?: Date | string | null;
};

// The three lines every on-cost view shows (form defaults only - the percent is always entered by an Admin).
export const STANDARD_LINES: { line: string; label: string; base: Base; appliesTo: AppliesTo }[] = [
  { line: "SUPER", label: "Super", base: "PAID", appliesTo: "EMPLOYEE" },
  { line: "WORKERS_COMP", label: "Workers comp", base: "PAID_PLUS_SUPER", appliesTo: "ALL" },
  { line: "PAYROLL_TAX", label: "Payroll tax", base: "PAID_PLUS_SUPER", appliesTo: "ALL" },
];

export const cents = (n: number) => Math.round(n * 100) / 100;

// The rate in force for a line on a date: the latest row (not retired) whose effective date is on or before it.
export function rateOn(rows: RateRow[], line: string, date: string): RateRow | null {
  let best: RateRow | null = null;
  for (const r of rows) {
    if (r.line !== line || r.retiredAt || r.effectiveFrom > date) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best;
}

// Every line to show: the standard three, then any other line an Admin added (in the order first added).
export function lineList(rows: RateRow[]): { line: string; label: string }[] {
  const out = STANDARD_LINES.map(({ line, label }) => ({ line, label }));
  for (const r of rows) if (!r.retiredAt && !out.some((l) => l.line === r.line)) out.push({ line: r.line, label: r.label });
  return out;
}

export type LabourLine = {
  projectId: string; projectName: string; date: string; personKey: string; personName: string;
  engagement: string | null; // EMPLOYEE | ABN | null (not set - counted as an employee)
  paid: number | null; // null = uncosted on Tracking (no rate / no hours)
};
export type CostedLine = LabourLine & { lines: Record<string, number | null>; onCosts: number; complete: boolean };

// Financial year (1 July) a date falls in, e.g. "2026" for 2026-07-01 .. 2027-06-30.
export const fyOf = (date: string) => String(Number(date.slice(0, 4)) - (date.slice(5, 7) < "07" ? 1 : 0));

// Applies every line to every labour line, in date order. Super first (other lines may be on paid + super).
// Payroll tax ABOVE_THRESHOLD: the annual threshold is used up in date order across the financial year, and
// only the part of the year's running base above it is taxed.
export function applyOnCosts(input: LabourLine[], rows: RateRow[]): CostedLine[] {
  const lines = lineList(rows);
  const sorted = [...input].sort((a, b) => a.date.localeCompare(b.date) || a.personKey.localeCompare(b.personKey));
  const running = new Map<string, number>(); // `${line}|${fy}` -> base so far this financial year
  return sorted.map((l) => {
    const out: Record<string, number | null> = {};
    let complete = true;
    if (l.paid == null) {
      for (const { line } of lines) out[line] = null;
      return { ...l, lines: out, onCosts: 0, complete: false };
    }
    const employee = l.engagement !== "ABN";
    const superRate = rateOn(rows, "SUPER", l.date);
    const superAmt = superRate ? (superRate.appliesTo === "ALL" || employee ? cents((l.paid * superRate.percent) / 100) : 0) : null;
    for (const { line } of lines) {
      if (line === "SUPER") { out[line] = superAmt; if (superAmt == null) complete = false; continue; }
      const r = rateOn(rows, line, l.date);
      if (!r) { out[line] = null; complete = false; continue; }
      if (r.appliesTo === "EMPLOYEE" && !employee) { out[line] = 0; continue; }
      let base = r.base === "PAID_PLUS_SUPER" ? l.paid + (superAmt ?? 0) : l.paid;
      if (r.base === "PAID_PLUS_SUPER" && superAmt == null) complete = false; // can't be right until super is set
      if (r.thresholdRule === "ABOVE_THRESHOLD" && r.thresholdAnnual != null) {
        const k = `${line}|${fyOf(l.date)}`;
        const before = running.get(k) ?? 0, after = before + base;
        running.set(k, after);
        base = Math.max(0, after - r.thresholdAnnual) - Math.max(0, before - r.thresholdAnnual);
      }
      out[line] = cents((base * r.percent) / 100);
    }
    const onCosts = cents(Object.values(out).reduce<number>((n, v) => n + (v ?? 0), 0));
    return { ...l, lines: out, onCosts, complete };
  });
}

export type Group = { key: string; label: string; paid: number; lines: Record<string, number>; onCosts: number; companyCost: number; people: number; uncosted: number; incomplete: number };

// Monday of a date's week (Monday-Sunday weeks, as on Timesheets and Payroll).
export function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Totals per job, per week or per person. Uncosted lines (no paid amount) are counted, never summed as $0.
export function groupCosts(costed: CostedLine[], by: "project" | "week" | "person"): Group[] {
  const groups = new Map<string, Group & { who: Set<string> }>();
  for (const c of costed) {
    const key = by === "project" ? c.projectId : by === "week" ? mondayOf(c.date) : c.personKey;
    const label = by === "project" ? c.projectName : by === "week" ? `Week of ${mondayOf(c.date)}` : c.personName;
    const g = groups.get(key) ?? { key, label, paid: 0, lines: {}, onCosts: 0, companyCost: 0, people: 0, uncosted: 0, incomplete: 0, who: new Set<string>() };
    g.who.add(c.personKey);
    if (c.paid == null) g.uncosted++;
    else {
      g.paid += c.paid;
      for (const [line, v] of Object.entries(c.lines)) if (v != null) g.lines[line] = (g.lines[line] ?? 0) + v;
      g.onCosts += c.onCosts;
      if (!c.complete) g.incomplete++;
    }
    groups.set(key, g);
  }
  return [...groups.values()].map(({ who, ...g }) => ({
    ...g, paid: cents(g.paid), onCosts: cents(g.onCosts), companyCost: cents(g.paid + g.onCosts), people: who.size,
    lines: Object.fromEntries(Object.entries(g.lines).map(([k, v]) => [k, cents(v)])),
  }));
}

// An Admin's new rate: checked and cleaned. A percent of 0-100, a known base / applies-to, a date.
export function cleanRate(b: Record<string, unknown>): Omit<RateRow, "id" | "retiredAt"> & { note: string | null } | { error: string } {
  const std = STANDARD_LINES.find((l) => l.line === b.line);
  const otherName = typeof b.label === "string" ? b.label.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  if (!std && !(typeof b.line === "string" && b.line.startsWith("OTHER") && otherName.length >= 2)) return { error: "Pick the line (or name the other on-cost)." };
  const line = std ? std.line : `OTHER:${otherName.toLowerCase()}`;
  const percent = Number(b.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { error: "The percentage must be between 0 and 100." };
  const base = (b.base ?? std?.base) as Base, appliesTo = (b.appliesTo ?? std?.appliesTo) as AppliesTo;
  if (base !== "PAID" && base !== "PAID_PLUS_SUPER") return { error: "Pick what it's a percentage of." };
  if (appliesTo !== "EMPLOYEE" && appliesTo !== "ALL") return { error: "Pick who it applies to." };
  if (line === "SUPER" && base !== "PAID") return { error: "Super is a percentage of what's paid." };
  const effectiveFrom = typeof b.effectiveFrom === "string" ? b.effectiveFrom : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) return { error: "Enter the date it applies from." };
  let thresholdRule: ThresholdRule | null = null, thresholdAnnual: number | null = null;
  if (line === "PAYROLL_TAX") {
    thresholdRule = b.thresholdRule === "ABOVE_THRESHOLD" ? "ABOVE_THRESHOLD" : "FLAT";
    if (thresholdRule === "ABOVE_THRESHOLD") {
      thresholdAnnual = Number(String(b.thresholdAnnual ?? "").replace(/[$,\s]/g, ""));
      if (!Number.isFinite(thresholdAnnual) || thresholdAnnual <= 0) return { error: "Enter the annual payroll tax threshold." };
    }
  }
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) || null : null;
  return { line, label: std ? std.label : otherName, percent, base, appliesTo, thresholdRule, thresholdAnnual, effectiveFrom, note };
}
