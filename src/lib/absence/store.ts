// "Not in today" (23 Nov 2026) - the database side. Marks are only ever added; an undo fills the row's cancelled
// fields and the row stays (keep forever). The plain rules are in ./rules.ts.
import { prisma } from "../prisma";
import { writeLock, type Tx, type Who } from "../history/store";
import { lockedWeekFor, weekEnd, weekStartOf } from "../timesheets";
import {
  cancelRefusal, markRefusal, NOT_ALLOCATED_REFUSAL, onOfficeList, toMark, whoRefusal, type AbsenceLine, type AbsenceRow, type MarkInput,
} from "./rules";

type Problem = { error: string; status: number };
const byName = (w: Who) => ((w?.name && w.name.trim()) || "Office").slice(0, 120);

// Every mark (live and undone) on these days.
export function absencesForDates(dates: string[]): Promise<AbsenceRow[]> {
  if (!dates.length) return Promise.resolve([]);
  return prisma.attendanceAbsence.findMany({ where: { date: { in: dates } }, orderBy: { createdAt: "asc" } });
}

// The live marks on these days, as "<resourceId>|<date>" (the "not signed in" alerts leave them out).
export async function activeAbsenceKeys(dates: string[]): Promise<Set<string>> {
  if (!dates.length) return new Set();
  const rows = await prisma.attendanceAbsence.findMany({ where: { date: { in: dates }, cancelledAt: null }, select: { resourceId: true, date: true } });
  return new Set(rows.map((r) => `${r.resourceId}|${r.date}`));
}

// The week's live marks for Labour-register staff, as timesheet lines (a labour hire tile isn't on the staff timesheet).
export async function absenceLinesForWeek(weekStart: string): Promise<AbsenceLine[]> {
  const rows = await prisma.attendanceAbsence.findMany({
    where: { date: { gte: weekStart, lte: weekEnd(weekStart) }, cancelledAt: null },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  if (!rows.length) return [];
  const people = new Map(
    (await prisma.resource.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.resourceId))] }, type: "PERSONNEL" }, select: { id: true, name: true, role: true } }))
      .map((p) => [p.id, p]),
  );
  return rows.flatMap((r) => {
    const p = people.get(r.resourceId);
    if (!p) return [];
    const m = toMark(r);
    return [{ absenceId: r.id, date: r.date, resourceId: p.id, name: p.name, role: p.role, reason: m.reason, label: m.label, note: m.note, by: m.by, at: m.at }];
  });
}

// The week's live marks for everyone (staff and labour hire tiles), with names - accounts' Payroll lists them.
export async function absencesForWeek(weekStart: string) {
  const rows = await prisma.attendanceAbsence.findMany({
    where: { date: { gte: weekStart, lte: weekEnd(weekStart) }, cancelledAt: null },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const who = new Map(
    (await prisma.resource.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.resourceId))] } }, select: { id: true, name: true, type: true } }))
      .map((p) => [p.id, p]),
  );
  return rows.map((r) => ({ ...toMark(r), resourceId: r.resourceId, date: r.date, name: who.get(r.resourceId)?.name ?? "Someone", hireTile: who.get(r.resourceId)?.type === "HIRE" }));
}

// NI-004: the week's lock read inside the caller's transaction (after writeLock), so an approval that lands between the
// first check and the write is still seen.
const lockedInTx = async (tx: Tx, date: string) =>
  (await tx.timesheetWeek.findFirst({ where: { weekStart: weekStartOf(date), reopenedAt: null }, select: { id: true } })) ? weekStartOf(date) : null;

// NI-002: on that day's board - an allocation on a running (ACTIVE, not cancelled) job that day, the same jobs the
// Sign-ins page lists as "Allocated, not signed in" - or on the Office list on a weekday.
async function onBoard(who: { id: string; type: string; category: string | null; active: boolean }, date: string) {
  if (onOfficeList(who, date)) return true;
  return (await prisma.assignment.count({ where: { resourceId: who.id, job: { date: new Date(`${date}T00:00:00.000Z`), status: "ACTIVE", cancelledAt: null } } })) > 0;
}

// Mark a person Sick / Not in for a day. An active Labour-register person or a labour hire tile on that day's board
// (NI-002); one live mark per person per day (checked inside one locked transaction, so two taps at once can't make
// two); a locked week refuses - checked again inside the transaction (NI-004).
export async function markAbsence(input: MarkInput, by: Who): Promise<{ id: string } | Problem> {
  const who = await prisma.resource.findUnique({ where: { id: input.resourceId }, select: { id: true, type: true, category: true, active: true } });
  const bad = whoRefusal(who);
  if (bad) return { error: bad, status: 400 };
  const lockedWeek = await lockedWeekFor(input.date);
  if (lockedWeek) return markRefusal({ lockedWeek, active: null })!;
  if (!(await onBoard(who!, input.date))) return { error: NOT_ALLOCATED_REFUSAL, status: 400 };
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const active = await tx.attendanceAbsence.findFirst({ where: { resourceId: input.resourceId, date: input.date, cancelledAt: null }, select: { reason: true } });
    const refused = markRefusal({ lockedWeek: await lockedInTx(tx, input.date), active });
    if (refused) return refused;
    const row = await tx.attendanceAbsence.create({
      data: { resourceId: input.resourceId, date: input.date, reason: input.reason, note: input.note, createdBy: byName(by), createdById: by?.id ?? null },
      select: { id: true },
    });
    return { id: row.id };
  });
}

// Undo a mark, with a reason. The row stays (the history); a locked week refuses. NI-004: one locked transaction - the
// mark and the week's lock are read after writeLock, then the undo is written.
export async function cancelAbsence(id: string, reason: string, by: Who): Promise<{ ok: true } | Problem> {
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const row = await tx.attendanceAbsence.findUnique({ where: { id }, select: { id: true, date: true, cancelledAt: true } });
    const refused = cancelRefusal({ row, lockedWeek: row ? await lockedInTx(tx, row.date) : null });
    if (refused) return refused;
    // Only a live mark is filled in - a second undo can never overwrite the first.
    const done = await tx.attendanceAbsence.updateMany({
      where: { id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelledBy: byName(by), cancelledById: by?.id ?? null, cancelReason: reason },
    });
    if (!done.count) return { error: "That mark has already been undone.", status: 409 };
    return { ok: true as const };
  });
}
