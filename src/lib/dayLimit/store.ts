// Days-a-week limit (12 Nov 2026) - the database side of lib/dayLimit/rules.ts: the dates a person is on the board in a
// week, the board's check (refuse / Admin override with a reason), the Sign-ins flag and the Admins' alert. Names and
// dates only, never money.
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { pushToAdmins } from "../push";
import {
  ALERT_SWITCH, OVER_LIMIT_ALERT_KIND, OVERRIDE_ACTION, checkDay, limitMessage, limitOf, overLimitAlert, overLimitDates, overLimitNote,
  overrideDecision, overrideNote, weekMonday, weekSunday,
} from "./rules";

const at = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dayAfter = (date: string) => new Date(at(date).getTime() + 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// The dates each person is on the board in the Mon-Sun week of `date` (jobs that aren't cancelled - running, stood down
// or completed). `exceptAssignmentIds` / `exceptJobId`: leave out the allocation being moved / the job being moved.
export async function boardDatesInWeek(resourceIds: string[], date: string, except: { assignmentIds?: string[]; jobId?: string } = {}) {
  const out = new Map<string, string[]>();
  if (!resourceIds.length) return out;
  const rows = await prisma.assignment.findMany({
    where: {
      resourceId: { in: resourceIds },
      ...(except.assignmentIds?.length ? { id: { notIn: except.assignmentIds } } : {}),
      job: { cancelledAt: null, date: { gte: at(weekMonday(date)), lt: dayAfter(weekSunday(date)) }, ...(except.jobId ? { id: { not: except.jobId } } : {}) },
    },
    select: { resourceId: true, job: { select: { date: true } } },
  });
  for (const r of rows) out.set(r.resourceId, [...(out.get(r.resourceId) ?? []), iso(r.job.date)]);
  return out;
}

export type LimitedPerson = { id: string; name: string; type: string; maxDaysPerWeek: number | null };
export type BoardDayResult =
  | { ok: true; override: string | null } // override: the history line to keep (an Admin went over the limit)
  | { ok: false; status: number; body: { error: string; code?: string; canOverride?: boolean } };

// The board's check for putting `people` on `target` (assign, move, a job moved to another day). Labour-register people
// with a limit only. Over it: refused (409) - unless an Admin sent `overrideReason` (a reason is required; a Manager's
// is refused). `body.overrideReason` present = the person asked to go over.
export async function checkBoardDay(
  people: LimitedPerson[], target: string, role: string | null | undefined, body: Record<string, unknown>,
  except: { assignmentIds?: string[]; jobId?: string } = {},
): Promise<BoardDayResult> {
  const limited = people.filter((p) => p.type === "PERSONNEL" && limitOf(p.maxDaysPerWeek) != null);
  if (!limited.length) return { ok: true, override: null };
  const dates = await boardDatesInWeek(limited.map((p) => p.id), target, except);
  const over = limited
    .map((p) => ({ p, c: checkDay(p.maxDaysPerWeek, dates.get(p.id) ?? [], target) }))
    .filter((x): x is { p: LimitedPerson; c: { ok: false; limit: number; already: string[] } } => !x.c.ok);
  if (!over.length) return { ok: true, override: null };
  if (body && typeof body === "object" && "overrideReason" in body) {
    const d = overrideDecision(role, body.overrideReason);
    if (!d.ok) return { ok: false, status: d.status, body: { error: d.error } };
    return { ok: true, override: over.map(({ p, c }) => overrideNote(p.name, c.limit, c.already, target, d.reason)).join("; ") };
  }
  return {
    ok: false, status: 409,
    body: { error: over.map(({ p, c }) => limitMessage(p.name, c.limit, c.already)).join(" "), code: "DAY_LIMIT", canOverride: role === "ADMIN" },
  };
}

// The Admin's override, kept in the board history (BoardEdit) in the same transaction as the change. Throws - never an
// override without its record.
export async function recordOverride(tx: Prisma.TransactionClient, who: { id: string; name: string }, date: string, note: string) {
  await tx.boardEdit.create({ data: { date, action: OVERRIDE_ACTION, detail: note.slice(0, 200), userId: who.id, by: who.name } });
}

// Copy day: the people with a limit the copy would place on `target`, and the dates they're on the board that week.
export async function copyPeople(resourceIds: string[], target: string) {
  const limited = await prisma.resource.findMany({
    where: { id: { in: [...new Set(resourceIds)] }, type: "PERSONNEL", maxDaysPerWeek: { not: null } },
    select: { id: true, name: true, maxDaysPerWeek: true },
  });
  const dates = await boardDatesInWeek(limited.map((p) => p.id), target);
  return limited.map((p) => ({ resourceId: p.id, name: p.name, limit: p.maxDaysPerWeek, onBoard: dates.get(p.id) ?? [] }));
}

// ---------- sign-ins: flag, never refuse ----------

// For the Sign-ins page and Timesheets: person -> (date -> "Over 3-day limit (4th day this week)") for the people
// given, over the Mon-Sun weeks of the dates given. Non-rejected sign-ins only (removed ones are rejected).
export async function overLimitNotes(resourceIds: string[], dates: string[]): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  const ids = [...new Set(resourceIds.filter(Boolean))];
  if (!ids.length || !dates.length) return out;
  const limited = await prisma.resource.findMany({ where: { id: { in: ids }, maxDaysPerWeek: { not: null } }, select: { id: true, maxDaysPerWeek: true } });
  if (!limited.length) return out;
  const sorted = [...dates].sort();
  const rows = await prisma.siteAttendance.findMany({
    where: { resourceId: { in: limited.map((p) => p.id) }, status: { not: "REJECTED" }, removedAt: null, date: { gte: weekMonday(sorted[0]), lte: weekSunday(sorted[sorted.length - 1]) } },
    select: { resourceId: true, date: true },
  });
  for (const p of limited) {
    const limit = limitOf(p.maxDaysPerWeek);
    if (limit == null) continue;
    const over = overLimitDates(limit, rows.filter((r) => r.resourceId === p.id).map((r) => r.date));
    if (!over.size) continue;
    out.set(p.id, new Map([...over].map(([d, nth]) => [d, overLimitNote(limit, nth)])));
  }
  return out;
}

// After every sign-in (lib/signInCreate.ts): over the limit that day -> one phone alert to the Admins per person per
// day (a ShiftReminder row claims it first, like the other once-a-day alerts). Never throws, never slows the sign-in
// down for the push itself. Returns whether this call claimed the alert (the release check reads the claim row).
export async function afterSignIn(row: { resourceId: string | null; date: string; status: string; workerName: string }): Promise<boolean> {
  try {
    if (!row.resourceId || row.status === "REJECTED") return false;
    const person = await prisma.resource.findUnique({ where: { id: row.resourceId }, select: { name: true, type: true, maxDaysPerWeek: true } });
    const limit = limitOf(person?.maxDaysPerWeek);
    if (!person || person.type !== "PERSONNEL" || limit == null) return false;
    const rows = await prisma.siteAttendance.findMany({
      where: { resourceId: row.resourceId, status: { not: "REJECTED" }, removedAt: null, date: { gte: weekMonday(row.date), lte: weekSunday(row.date) } },
      select: { date: true },
    });
    const nth = overLimitDates(limit, rows.map((r) => r.date)).get(row.date);
    if (!nth) return false;
    if ((process.env[ALERT_SWITCH] ?? "").trim().toLowerCase() === "off") return false;
    const claimed = await prisma.shiftReminder.create({ data: { jobId: `${row.resourceId}|${row.date}`, kind: OVER_LIMIT_ALERT_KIND, people: nth } }).catch(() => null);
    if (!claimed) return false;
    const msg = overLimitAlert(person.name, limit, nth, row.date);
    void pushToAdmins({ ...msg, url: `/attendance?date=${row.date}`, tag: `over-limit-${row.resourceId}-${row.date}` }).catch((e) => console.error("over day limit alert", e instanceof Error ? e.message : "failed"));
    return true;
  } catch (e) {
    console.error("day limit check after sign-in", e instanceof Error ? e.message : "failed");
    return false;
  }
}
