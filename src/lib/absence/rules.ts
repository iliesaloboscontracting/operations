// "Not in today" (23 Nov 2026, Ilies: "this also needs a button that can let the system know that the someone if off
// sick today or not in"; "yes build it, alex can too"). The plain rules - no database, no server imports, so the
// Sign-ins page, the timesheet grids and `npm test` (rules.test.ts) all read the same words.
//
// A mark is per person per Sydney day (every job they were on that day): SICK or NOT_IN, an optional short note, who
// marked it and when. Information only - it never adds hours, pay or cost. It takes the person out of the unexplained
// no-show counts. If they did sign in that day the sign-in still counts (sign-ins are the record) and the mark is
// flagged "Marked Sick but signed in" so someone checks it. Undo = cancel with a reason; the cancelled mark is kept.
import { assertNoMoney } from "../moneyGuard";
import { looksLikeTfnOrBank } from "../compliance/rules";
import { fileIsSafe } from "../payroll/rules";

export const ABSENCE_REASONS = ["SICK", "NOT_IN"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];
export const ABSENCE_LABEL: Record<AbsenceReason, string> = { SICK: "Sick", NOT_IN: "Not in" };
export const absenceLabel = (reason: string) => ABSENCE_LABEL[reason as AbsenceReason] ?? "Not in";
export const isAbsenceReason = (v: unknown): v is AbsenceReason => typeof v === "string" && (ABSENCE_REASONS as readonly string[]).includes(v);

export const ABSENCE_LIMITS = {
  /** The optional note on a mark. */
  noteMax: 200,
  /** The reason an undo needs. */
  cancelReasonMin: 3,
  cancelReasonMax: 300,
  /** NI-002: how far back a mark may go (Sydney days before today). Up to tomorrow ahead. */
  daysBack: 14,
} as const;
// NI-001 a: the note box's hint - the note is for the office; never medical details.
export const NOTE_HINT = "e.g. rang in at 6am - no medical details";

// What the database row holds (lib/absence/store.ts).
export type AbsenceRow = {
  id: string; resourceId: string; date: string; reason: string; note: string | null;
  createdBy: string; createdAt: Date | string;
  cancelledAt: Date | string | null; cancelledBy: string | null; cancelReason: string | null;
};
// One mark as the screens show it.
export type AbsenceMark = {
  id: string; reason: AbsenceReason; label: string; note: string | null; by: string; at: string;
  cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null;
};
// A person-day: the live mark (if any), the undone ones (history), and whether they signed in anywhere that day.
export type AbsenceView = { active: AbsenceMark | null; cancelled: AbsenceMark[]; signedIn: boolean };

const isoOf = (d: Date | string | null) => (d == null ? null : typeof d === "string" ? d : d.toISOString());
export const toMark = (r: AbsenceRow): AbsenceMark => ({
  id: r.id, reason: isAbsenceReason(r.reason) ? r.reason : "NOT_IN", label: absenceLabel(r.reason), note: r.note,
  by: r.createdBy, at: isoOf(r.createdAt)!, cancelledAt: isoOf(r.cancelledAt), cancelledBy: r.cancelledBy, cancelReason: r.cancelReason,
});
export const dayKey = (resourceId: string, date: string) => `${resourceId}|${date}`;

// ---------- input ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string) => ISO.test(d) && !Number.isNaN(new Date(`${d}T12:00:00Z`).getTime()) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

// Free text on a mark or an undo: never an amount, bank or tax detail - so every export that carries it still passes
// the payroll file check (fileIsSafe). Null = fine, else the words to show.
export function textRefusal(s: string): string | null {
  if (!assertNoMoney(s)) return "No amounts in the note, please.";
  if (looksLikeTfnOrBank(s, { freeText: true }) || !fileIsSafe(s)) return "No bank, tax or rate details in the note, please.";
  return null;
}

const shiftDay = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const tomorrowOf = (today: string) => shiftDay(today, 1);
// NI-002: the days a mark may be for - today minus 14 days to tomorrow. Null = fine, else the words.
export function markDateRefusal(date: string, today: string): string | null {
  if (date > tomorrowOf(today)) return "You can only mark up to tomorrow.";
  if (date < shiftDay(today, -ABSENCE_LIMITS.daysBack)) return `You can only mark the last ${ABSENCE_LIMITS.daysBack} days (or tomorrow).`;
  return null;
}
// NI-002: only someone on that day's board (a job's allocation, or the Office list on a weekday) can be marked, and only
// an active Labour-register person or a labour hire booking. Null = fine.
export function whoRefusal(r: { type: string; category: string | null; active: boolean } | null): string | null {
  if (!r || !(r.type === "PERSONNEL" || (r.type === "HIRE" && r.category === "LABOUR"))) return "Pick someone from the Labour register (or a labour hire booking).";
  if (!r.active) return "That person is switched off on the register.";
  return null;
}
export const isWeekday = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };
// The Office list (lib/signin.ts pointCrew("OFFICE")): active Labour-register staff in category Office, Monday to Friday.
export const onOfficeList = (r: { type: string; category: string | null; active: boolean }, date: string) =>
  r.type === "PERSONNEL" && r.active && r.category === "Office" && isWeekday(date);
export const NOT_ALLOCATED_REFUSAL = "They aren't on the board that day - only someone allocated (or on the Office list) can be marked.";

export type MarkInput = { resourceId: string; date: string; reason: AbsenceReason; note: string | null };
export function parseMark(body: unknown, today: string): { ok: true; value: MarkInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const resourceId = typeof b.resourceId === "string" ? b.resourceId.trim() : "";
  const date = typeof b.date === "string" ? b.date.trim() : "";
  if (!resourceId) return { ok: false, error: "Pick who it is." };
  if (!validDay(date)) return { ok: false, error: "Pick the day." };
  // NI-002 (Ilies approved 23 Nov 2026, "Yes, allow tomorrow"): from 14 days back up to tomorrow (Sydney) - nothing older
  // (an old week is the office's to fix through the timesheet), nothing further ahead.
  const r = markDateRefusal(date, today);
  if (r) return { ok: false, error: r };
  if (!isAbsenceReason(b.reason)) return { ok: false, error: "Pick Sick or Not in." };
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
  if (note.length > ABSENCE_LIMITS.noteMax) return { ok: false, error: `Keep the note under ${ABSENCE_LIMITS.noteMax} characters.` };
  const bad = note ? textRefusal(note) : null;
  if (bad) return { ok: false, error: bad };
  return { ok: true, value: { resourceId, date, reason: b.reason, note: note || null } };
}

export function parseCancel(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length < ABSENCE_LIMITS.cancelReasonMin) return { ok: false, error: "Say why it's being undone." };
  if (reason.length > ABSENCE_LIMITS.cancelReasonMax) return { ok: false, error: `Keep the reason under ${ABSENCE_LIMITS.cancelReasonMax} characters.` };
  const bad = textRefusal(reason);
  if (bad) return { ok: false, error: bad };
  return { ok: true, reason };
}

// ---------- who may, and when ----------

export const LOCKED_WEEK_REFUSAL = "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its sign-ins can change.";
export const DUPLICATE_REFUSAL = (label: string) => `Already marked ${label} for that day - undo it first to change it.`;

// Marking: one live mark per person per day; a locked week refuses (the same as any office sign-in change).
export function markRefusal(o: { lockedWeek: string | null; active: { reason: string } | null }): { error: string; status: number } | null {
  if (o.lockedWeek) return { error: LOCKED_WEEK_REFUSAL, status: 409 };
  if (o.active) return { error: DUPLICATE_REFUSAL(absenceLabel(o.active.reason)), status: 409 };
  return null;
}
// Undoing: only a live mark; a locked week refuses.
export function cancelRefusal(o: { row: { cancelledAt: unknown } | null; lockedWeek: string | null }): { error: string; status: number } | null {
  if (!o.row) return { error: "That mark isn't there.", status: 404 };
  if (o.row.cancelledAt) return { error: "That mark has already been undone.", status: 409 };
  if (o.lockedWeek) return { error: LOCKED_WEEK_REFUSAL, status: 409 };
  return null;
}

// ---------- what a mark does ----------

// The person-days for the rows given (any days): the live mark, the undone ones, and whether they signed in anywhere
// that day (signedIn: the keys "<resourceId>|<date>" with a sign-in that wasn't rejected or removed).
export function absenceViews(rows: AbsenceRow[], signedIn: Set<string>): Map<string, AbsenceView> {
  const out = new Map<string, AbsenceView>();
  const sorted = [...rows].sort((a, b) => String(isoOf(a.createdAt)).localeCompare(String(isoOf(b.createdAt))));
  for (const r of sorted) {
    const k = dayKey(r.resourceId, r.date);
    const v = out.get(k) ?? { active: null, cancelled: [], signedIn: signedIn.has(k) };
    if (r.cancelledAt) v.cancelled.push(toMark(r));
    else v.active = toMark(r); // at most one live mark (the store makes sure); the latest wins if ever two
    out.set(k, v);
  }
  return out;
}

export const isMarked = (n: { absence?: { active: unknown } | null }) => !!n.absence?.active;
// The no-shows that still need explaining: everyone listed who has no live mark.
export const unexplained = <T extends { absence?: { active: unknown } | null }>(noShows: T[]): T[] => noShows.filter((n) => !isMarked(n));
// "N no sign-in" (the Sign-ins strip, the Timesheets banner): no sign-in anywhere that day and not marked.
export const noSignInCount = (noShows: { nowhere?: boolean; absence?: { active: unknown } | null }[]) =>
  noShows.filter((s) => s.nowhere && !isMarked(s)).length;
// Marked off, but a sign-in that day - the sign-in counts; someone checks the mark.
export const markedButSignedIn = (v: AbsenceView | null | undefined) => !!v?.active && v.signedIn;
export const markedButSignedInText = (label: string) => `Marked ${label} but signed in`;

// Words for a mark's detail (the tag's hover / tap): "Sick - flu (marked by Alex, 23 Nov 7:40am)".
export function markWords(m: AbsenceMark, when: (iso: string) => string = (s) => s): string {
  return `${m.label}${m.note ? ` - ${m.note}` : ""} (marked by ${m.by}, ${when(m.at)})`;
}

// ---------- the timesheets ----------

// One mark on a staff timesheet (and locked into the week's snapshot). Labour-register staff only.
export type AbsenceLine = {
  absenceId: string; date: string; resourceId: string; name: string; role: string | null;
  reason: AbsenceReason; label: string; note: string | null; by: string; at: string;
};

// NI-001 c: a timesheet's people with every mark's note taken out (the label, who and when stay) - for the review-only
// TIMESHEETS login.
export function withoutAbsenceNotes<P extends { absences?: Record<string, AbsenceLine> }>(people: P[]): P[] {
  return people.map((p) => (p.absences ? { ...p, absences: Object.fromEntries(Object.entries(p.absences).map(([d, a]) => [d, { ...a, note: null }])) } : p));
}

// A day's cell: the marker, never any hours. warn = they signed in that day too (the sign-in's hours stand).
export function timesheetDayCell(a: AbsenceLine | null | undefined, linesThatDay: { hours: number | null }[]): { label: string; hours: null; warn: boolean; text: string } | null {
  if (!a) return null;
  const warn = linesThatDay.length > 0;
  return { label: a.label, hours: null, warn, text: warn ? markedButSignedInText(a.label) : a.label };
}

// The CSV's notes for a mark: the label, who marked it, and the check when they signed in too. NI-001 b (Ilies
// approved 23 Nov 2026): the note itself never goes in a file - it stays on screen for the office and accounts.
export function absenceCsvNotes(a: Pick<AbsenceLine, "label" | "by">, signedIn: boolean): string {
  return [
    `${a.label} - no hours`,
    `Marked by ${a.by}`,
    ...(signedIn ? [`${markedButSignedInText(a.label)} - check`] : []),
  ].join("; ");
}
