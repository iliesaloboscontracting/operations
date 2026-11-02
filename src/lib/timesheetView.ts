// Timesheet screen helpers (2 Nov 2026, Ilies after "Turori signed in on Thursday and Friday but these have not
// been recorded in the timesheets page" - they were, in his truck's box at the bottom of "By site"). Display only:
// no hours are changed here. Plain, no server imports, so both the screens and `npm test` use them.
import type { TimesheetPerson } from "./timesheets";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Any YYYY-MM-DD -> the Monday of its week (the week a link like ?week=2026-10-30 opens). Null for anything else.
export function mondayOf(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(date + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || iso(d) !== date) return null;
  const day = d.getUTCDay(); // 0 = Sunday
  return iso(new Date(d.getTime() + (day === 0 ? -6 : 1 - day) * 86_400_000));
}

// In a "By site" box: the person's whole week (every site, the office, yard and trucks) and the other places they
// signed in or travelled to, so a box's row never reads like their week.
export function allPlaces(p: Pick<TimesheetPerson, "total" | "travelTotal" | "days" | "travel">, site: string) {
  const places = new Set<string>();
  for (const ls of Object.values(p.days)) for (const l of ls) places.add(l.site);
  for (const ts of Object.values(p.travel ?? {})) for (const t of ts) places.add(t.site);
  places.delete(site);
  return { total: p.total, travelTotal: p.travelTotal ?? 0, also: [...places].sort((a, b) => a.localeCompare(b)) };
}
