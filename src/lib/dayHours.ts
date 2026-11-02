// Hours from sign-ins, worked out per person per day (2 Nov 2026, Ilies: "break once per day over 5h"; the week of
// 26 Oct review). Replaces the old per-sign-in break. Plain, no database - ./dayHoursStore.ts loads the lines.
//
//   1. A person's sign-ins on one day are merged: time covered by two lines at once (a truck QR and a site tick-in,
//      say) counts once. Each line keeps the part no earlier line already covered, and both are flagged "overlap".
//   2. One unpaid break per person per day, only when the day's worked total is OVER 5 hours. The break is the
//      largest break setting among that day's lines (a project's unpaidBreakMinutes; office / yard / truck points
//      POINT_BREAK_MINUTES). It comes off the day's longest line (any remainder off the next), never below 0.
//   3. Each line is rounded to the nearest quarter hour, as before, so the lines add up to the day.
// A line with no sign-out has no hours (null) and takes no part in the day's total. Travel legs are not in here.

export const BREAK_OVER_MINUTES = 5 * 60;

export type DayLine = { id: string; personKey: string; date: string; start: Date; end: Date | null; breakMinutes: number | null };
export type LineHours = { hours: number | null; overlap: boolean; breakMinutes: number };

const MIN = 60_000;
const q4 = (n: number) => Math.round(n * 4) / 4;

export function dayHours(lines: DayLine[]): Map<string, LineHours> {
  const out = new Map<string, LineHours>();
  const groups = new Map<string, DayLine[]>();
  for (const l of lines) {
    if (!l.end) { out.set(l.id, { hours: null, overlap: false, breakMinutes: 0 }); continue; }
    const k = `${l.personKey}|${l.date}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const ls of groups.values()) {
    const sorted = [...ls].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end!.getTime() - a.end!.getTime() || a.id.localeCompare(b.id));
    const own = new Map<string, number>(); // minutes this line adds that no earlier line covered
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
    const total = [...own.values()].reduce((n, m) => n + m, 0);
    const taken = new Map<string, number>();
    if (total > BREAK_OVER_MINUTES) {
      let left = Math.max(0, ...ls.map((l) => l.breakMinutes ?? 0));
      for (const l of [...ls].sort((a, b) => own.get(b.id)! - own.get(a.id)! || a.id.localeCompare(b.id))) {
        if (left <= 0) break;
        const t = Math.min(left, own.get(l.id)!);
        taken.set(l.id, t);
        left -= t;
      }
    }
    for (const l of ls) {
      const t = taken.get(l.id) ?? 0;
      out.set(l.id, { hours: q4(Math.max(0, own.get(l.id)! - t) / 60), overlap: overlap.has(l.id), breakMinutes: Math.round(t) });
    }
  }
  return out;
}

// The person a sign-in belongs to: their register record, or (hire / subcontract) the name and company typed.
export const personKeyFor = (resourceId: string | null, name: string, company: string | null) =>
  resourceId ?? `hire:${name.trim().toLowerCase().replace(/\s+/g, " ")}|${(company ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;
