import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { logBoardRemoval } from "@/lib/boardGuard/store";
import { writeLock } from "@/lib/history/store";
import { ASSIGNMENT_FOR_SNAPSHOT, allocationSnapshot } from "@/lib/boardGuard/snapshot";

// POST /api/jobs/clear { date: "YYYY-MM-DD" }
// Resets every job on that date (running or not) back to a blank slate: unassigns
// every crew/plant/hire allocation and wipes each job's day brief. The jobs
// themselves - and everything else about them (times, site, shift) - are untouched.
// Keep forever (Ilies, 10 Nov 2026): every allocation removed and every day brief emptied is kept in full in the
// CLEAR BoardEdit's snapshot, written in the same transaction - nothing goes unrecorded.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();

  const { date } = await req.json().catch(() => ({}));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD is required" }, { status: 400 });
  }
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const dateFilter = { date: { gte: start, lt: end } };

  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { cleared, briefsCleared } = await prisma.$transaction(async (tx) => {
    await writeLock(tx); // write lock first, then read what is removed (no deadlock with another writer)
    const rows = await tx.assignment.findMany({ where: { job: { ...dateFilter, cancelledAt: null } }, include: ASSIGNMENT_FOR_SNAPSHOT, orderBy: { createdAt: "asc" } });
    const briefs = await tx.job.findMany({ where: { ...dateFilter, cancelledAt: null, dayBrief: { not: null } }, select: { id: true, title: true, date: true, shift: true, dayBrief: true } });
    if (rows.length) await tx.assignment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    if (briefs.length) await tx.job.updateMany({ where: { id: { in: briefs.map((b) => b.id) } }, data: { dayBrief: null } });
    await logBoardRemoval(tx, user, date, "CLEAR", `${rows.length} allocation${rows.length === 1 ? "" : "s"}, ${briefs.length} day brief${briefs.length === 1 ? "" : "s"}`, {
      v: 1, kind: "CLEAR", allocations: rows.map(allocationSnapshot),
      briefs: briefs.map((b) => ({ jobId: b.id, jobTitle: b.title, jobDate: b.date.toISOString().slice(0, 10), shift: b.shift, dayBrief: b.dayBrief ?? "" })),
    });
    return { cleared: rows.length, briefsCleared: briefs.length };
  });
  return NextResponse.json({ cleared, briefsCleared });
});
