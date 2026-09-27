import { localISODate } from "./resource";

// All helpers work on calendar days as "YYYY-MM-DD" strings (no time zones involved).

export function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return localISODate(d);
}

// Whole days from a to b (b - a), DST-safe.
export function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Weeks start on Monday.
export function startOfWeek(iso: string) {
  const dow = (parseISO(iso).getDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function startOfMonth(iso: string) {
  return iso.slice(0, 8) + "01";
}

export function endOfMonth(iso: string) {
  const d = parseISO(iso);
  return localISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function rangeDays(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isWeekend(iso: string) {
  const g = parseISO(iso).getDay();
  return g === 0 || g === 6;
}

export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions) {
  return parseISO(iso).toLocaleDateString("en-AU", opts);
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Hire start/finish dates are free text (e.g. "22 Sept", "6 Oct", "22/9/26")
// rather than a date picker, so parsing them is best-effort. Returns null
// rather than guessing when the text doesn't match a recognised shape - it's
// only ever used to flag something as overdue, never to compute a cost, so a
// missed parse just means that one row doesn't get flagged, not a wrong figure.
export function parseLooseDate(text: string | null | undefined, referenceYear: number): Date | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  let m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?\s*(\d{4})?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monIdx = MONTH_INDEX[m[2].slice(0, 4).replace(/\.$/, "")] ?? MONTH_INDEX[m[2].slice(0, 3)];
    if (monIdx == null) return null;
    const year = m[3] ? parseInt(m[3], 10) : referenceYear;
    const d = new Date(year, monIdx, day);
    return isNaN(d.getTime()) ? null : d;
  }

  m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    let year = m[3] ? parseInt(m[3], 10) : referenceYear;
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}
