// Hours from sign-ins, worked out per person per day (2 Nov 2026, Ilies: "break once per day over 5h"; the week of
// 26 Oct review; security review TF-001/005/007/011; 12 Nov 2026, Ilies: "change it to over 4 hours from this week but
// adjust the hours on the new rule from last week aswell", "Alex is on salary and therefore this rule wouldnt apply to
// him or anyone else on salary"). Replaces the old per-sign-in break. Plain, no database - ./dayHoursStore.ts loads
// the lines.
//
//   1. A person's sign-ins on one day are merged: time covered by two lines at once (a truck QR and a site tick-in,
//      say) counts once, and both are flagged "overlap". Hire / subcontract lines (no register person) are flagged
//      the same way but merged only when they came from the same phone (TF-005): two workers who typed the same name
//      and company keep their own hours.
//   2. One unpaid break per person per day. The break is the largest setting among that day's lines (a project's
//      unpaidBreakMinutes; office / yard / truck POINT_BREAK_MINUTES). It comes off the day's longest line first.
//      - From BREAK_4H_FROM (Mon 2 Nov 2026): the whole break comes off any merged day OVER 4 hours, with no floor
//        (4:01 -> 3.5, 4:37 -> 4.0, 5:03 -> 4.5, 5:28 -> 5.0). 4 hours or less: no break. Labour hire the same.
//        Salaried people (the register's payRateBasis SALARY - the caller sets DayLine.noBreak) lose no break at all.
//      - BREAK_RULE_FROM (Mon 26 Oct) to the day before BREAK_4H_FROM: only a day OVER 5 hours, and the break never
//        takes it below 5 hours (TF-011, Ilies "never below 5": 5:10 -> 5.0, 5:30 -> 5.0, 6:00 -> 5.5).
//   3. The DAY is rounded once to the nearest quarter hour, then shared across its lines by largest remainder, so the
//      lines always add up to exactly the day (TF-001).
//   4. Before BREAK_RULE_FROM (TF-007a, Ilies: from Mon 26 Oct 2026) each line keeps the old rule: its own break,
//      rounded on its own, no merging. Salaried people too.
// A line with no sign-out has no hours (null) and takes no part in the day. Travel legs are not in here. Approved /
// locked timesheet weeks keep their stored snapshot - nothing here touches them.

export const BREAK_OVER_MINUTES = 5 * 60; // 26 Oct - 1 Nov 2026
export const BREAK_OVER_MINUTES_4H = 4 * 60; // from BREAK_4H_FROM
const DEFAULT_RULE_FROM = "2026-10-26";
const DEFAULT_4H_FROM = "2026-11-02";
const envDate = (name: string, fallback: string) => {
  const v = (typeof process !== "undefined" ? process.env[name] : undefined)?.trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
};
export const breakRuleFrom = () => envDate("BREAK_RULE_FROM", DEFAULT_RULE_FROM);
export const break4hFrom = () => envDate("BREAK_4H_FROM", DEFAULT_4H_FROM);

// Which break rule a Sydney date falls under (for the words on a page).
export type BreakRule = "PER_LINE" | "OVER_5H" | "OVER_4H";
export const breakRuleFor = (date: string, ruleFrom = breakRuleFrom(), from4h = break4hFrom()): BreakRule =>
  date < ruleFrom ? "PER_LINE" : date < from4h ? "OVER_5H" : "OVER_4H";

// The salaried flag for a DayLine, from the register person's pay basis (Resource.payRateBasis).
export const isSalaried = (r: { payRateBasis?: string | null } | null | undefined) => r?.payRateBasis === "SALARY";

// noBreak: a salaried person - no break comes off from BREAK_4H_FROM. Ignored before it, and on hire / subcontract
// lines (no register person is ever salaried).
export type DayLine = { id: string; personKey: string; date: string; start: Date; end: Date | null; breakMinutes: number | null; deviceId?: string | null; noBreak?: boolean };
export type LineHours = { hours: number | null; overlap: boolean; breakMinutes: number };

const MIN = 60_000;
const q4 = (n: number) => Math.round(n * 4) / 4;
const isHire = (personKey: string) => personKey.startsWith("hire:");

// The old rule, kept for dates before BREAK_RULE_FROM (lib/signin.ts signedHours, unchanged).
function perLine(l: DayLine): LineHours {
  const gross = (l.end!.getTime() - l.start.getTime()) / 3_600_000;
  if (gross <= 0) return { hours: 0, overlap: false, breakMinutes: 0 };
  const b = l.breakMinutes ?? 0;
  return { hours: Math.max(0, q4(gross - b / 60)), overlap: false, breakMinutes: b };
}

// Each line's minutes that no earlier line in the group already covered, plus which lines overlapped.
function sweep(ls: DayLine[]) {
  const sorted = [...ls].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end!.getTime() - a.end!.getTime() || a.id.localeCompare(b.id));
  const own = new Map<string, number>();
  const overlap = new Set<string>();
  let coveredUntil = -Infinity;
  let coveringId: string | null = null;
  for (const l of sorted) {
    const s = l.start.getTime(), e = l.end!.getTime();
    if (e <= s) { own.set(l.id, 0); continue; }
    if (s < coveredUntil) { overlap.add(l.id); if (coveringId) overlap.add(coveringId); }
    own.set(l.id, Math.max(0, e - Math.max(s, coveredUntil)) / MIN);
    if (e > coveredUntil) { coveredUntil = e; coveringId = l.id; }
  }
  return { own, overlap };
}

// One merged person-day (one phone, for hire): break, round once, share by largest remainder.
function mergedDay(ls: DayLine[], own: Map<string, number>, over4h: boolean): Map<string, { hours: number; breakMinutes: number }> {
  const covered = ls.reduce((n, l) => n + own.get(l.id)!, 0);
  const setting = Math.max(0, ...ls.map((l) => l.breakMinutes ?? 0));
  const salaried = ls.some((l) => l.noBreak && !isHire(l.personKey));
  const brk = over4h
    // From 2 Nov 2026: over 4 h the whole break comes off, no floor; salaried people none (Ilies, 12 Nov 2026).
    ? (covered > BREAK_OVER_MINUTES_4H && !salaried ? Math.min(setting, covered) : 0)
    // 26 Oct - 1 Nov 2026: over 5 h the break comes off, but never below 5 h (TF-011).
    : (covered > BREAK_OVER_MINUTES ? Math.min(setting, covered - BREAK_OVER_MINUTES) : 0);
  const taken = new Map<string, number>();
  let left = brk;
  for (const l of [...ls].sort((a, b) => own.get(b.id)! - own.get(a.id)! || a.id.localeCompare(b.id))) {
    if (left <= 0) break;
    const t = Math.min(left, own.get(l.id)!);
    taken.set(l.id, t);
    left -= t;
  }
  const net = ls.map((l) => ({ id: l.id, q: Math.max(0, own.get(l.id)! - (taken.get(l.id) ?? 0)) / 15 })); // in quarter hours
  const target = Math.round(net.reduce((n, x) => n + x.q, 0) + 1e-9); // the day, rounded once (TF-001)
  const base = net.map((x) => ({ ...x, f: Math.floor(x.q + 1e-9) }));
  let extra = target - base.reduce((n, x) => n + x.f, 0);
  for (const x of [...base].sort((a, b) => (b.q - b.f) - (a.q - a.f) || a.id.localeCompare(b.id))) {
    if (extra <= 0) break;
    x.f += 1;
    extra -= 1;
  }
  return new Map(base.map((x) => [x.id, { hours: x.f / 4, breakMinutes: Math.round(taken.get(x.id) ?? 0) }]));
}

export function dayHours(lines: DayLine[], ruleFrom = breakRuleFrom(), from4h = break4hFrom()): Map<string, LineHours> {
  const out = new Map<string, LineHours>();
  const days = new Map<string, DayLine[]>();
  for (const l of lines) {
    if (!l.end) { out.set(l.id, { hours: null, overlap: false, breakMinutes: 0 }); continue; }
    if (l.date < ruleFrom) { out.set(l.id, perLine(l)); continue; }
    const k = `${l.personKey}|${l.date}`;
    days.set(k, [...(days.get(k) ?? []), l]);
  }
  for (const ls of days.values()) {
    const { overlap } = sweep(ls); // overlaps are flagged across everyone with that name, phones or not
    // Merge groups: a register person's whole day; for hire, one phone each (no phone = that line alone).
    const groups = new Map<string, DayLine[]>();
    for (const l of ls) {
      const g = isHire(l.personKey) ? `dev:${l.deviceId ?? `line:${l.id}`}` : "all";
      groups.set(g, [...(groups.get(g) ?? []), l]);
    }
    for (const g of groups.values()) {
      const { own } = sweep(g);
      for (const [id, h] of mergedDay(g, own, g[0].date >= from4h)) out.set(id, { ...h, overlap: overlap.has(id) });
    }
  }
  return out;
}

// The person a sign-in belongs to: their register record, or (hire / subcontract) the name and company typed, tidied.
export const personKeyFor = (resourceId: string | null, name: string, company: string | null) =>
  resourceId ?? `hire:${name.trim().toLowerCase().replace(/\s+/g, " ")}|${(company ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;
