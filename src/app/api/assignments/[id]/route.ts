import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { sanitizeAssignment } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";
import { isoDay, logBoardEdit, logBoardRemoval, siteName } from "@/lib/boardGuard/store";
import { ASSIGNMENT_FOR_SNAPSHOT, allocationSnapshot } from "@/lib/boardGuard/snapshot";
import { writeLock } from "@/lib/history/store";
import { offHiredBefore, offHireStop } from "@/lib/hireEstimate";
import { fmtDay } from "@/lib/dates";
import { checkBoardDay, recordOverride } from "@/lib/dayLimit/store";

const JOB = { select: { date: true, title: true, shift: true } } as const;

// PATCH /api/assignments/:id
//  - { role }  -> change the role for this job assignment
//  - { jobId } -> move the resource to another job (drag chip between rows)
//    Days-a-week limit (12 Nov 2026, lib/dayLimit): a move onto a new date over the person's limit is refused (409);
//    an Admin may go over it with { overrideReason } (kept in the board history). Same date, or a date already counted: fine.
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  if (body.jobId) {
    const current = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: { job: JOB, resource: { select: { id: true, name: true, type: true, category: true, hireStatus: true, offHiredOn: true, offHireDate: true, maxDaysPerWeek: true } } },
    });
    if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (current.jobId === body.jobId) return NextResponse.json(current);

    const sourceLocked = await assertDateOpen(current.job.date.toISOString().slice(0, 10));
    if (sourceLocked) return sourceLocked;
    const targetJob = await prisma.job.findFirst({ where: { id: body.jobId, cancelledAt: null }, ...JOB });
    if (!targetJob) return NextResponse.json({ error: "not found" }, { status: 404 });
    const targetLocked = await assertDateOpen(targetJob.date.toISOString().slice(0, 10));
    if (targetLocked) return targetLocked;
    // Off-hired gear can't be moved onto a day after it was called off either (OH-005).
    const r = current.resource;
    if (r.type === "HIRE" && r.category !== "LABOUR" && offHiredBefore(r, isoDay(targetJob.date))) {
      const stop = offHireStop(r);
      return NextResponse.json(
        { error: `${r.name} was off-hired${stop ? ` on ${fmtDay(stop, { weekday: "short", day: "numeric", month: "short" })}` : ""} - put it back on hire on the Hire page first.` },
        { status: 400 },
      );
    }
    const limit = await checkBoardDay([r], isoDay(targetJob.date), user?.role, body, { assignmentIds: [params.id] });
    if (!limit.ok) return NextResponse.json(limit.body, { status: limit.status });
    // Noted once the move has gone through (BG-006), on both days when it crosses days.
    const logMove = async () => {
      const note = `${current.resource.name}: ${siteName(current.job)} -> ${siteName(targetJob)}`;
      for (const d of new Set([isoDay(current.job.date), isoDay(targetJob.date)])) await logBoardEdit(user, d, "MOVE", note);
    };

    // Already on the target job? Just drop the source so we don't violate the unique pair.
    const existing = await prisma.assignment.findUnique({
      where: { jobId_resourceId: { jobId: body.jobId, resourceId: current.resourceId } },
    });
    if (existing) {
      // Keep forever (10 Nov 2026): the source row goes only with a full snapshot of it, in the same transaction.
      if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      await prisma.$transaction(async (tx) => {
    await writeLock(tx); // write lock first, then read what is removed (no deadlock with another writer)
        const row = await tx.assignment.findUniqueOrThrow({ where: { id: params.id }, include: ASSIGNMENT_FOR_SNAPSHOT });
        await tx.assignment.delete({ where: { id: params.id } });
        await logBoardRemoval(tx, user, isoDay(current.job.date), "MOVE",
          `${current.resource.name}: ${siteName(current.job)} -> ${siteName(targetJob)} (already there - this tile removed)`,
          { v: 1, kind: "MOVE_DUPLICATE", allocations: [allocationSnapshot(row)] });
      });
      if (isoDay(current.job.date) !== isoDay(targetJob.date)) await logBoardEdit(user, isoDay(targetJob.date), "MOVE", `${current.resource.name}: ${siteName(current.job)} -> ${siteName(targetJob)}`);
      return NextResponse.json(existing);
    }
    const move = { where: { id: params.id }, data: { jobId: body.jobId as string }, include: { resource: true as const } };
    // An Admin's override is kept with the move, in one go.
    const moved = limit.override && user
      ? await prisma.$transaction(async (tx) => {
          const m = await tx.assignment.update(move);
          await recordOverride(tx, user, isoDay(targetJob.date), limit.override!);
          return m;
        })
      : await prisma.assignment.update(move);
    await logMove();
    sanitizeAssignment(moved, user?.role ?? null);
    return NextResponse.json(moved);
  }

  const roleTarget = await prisma.assignment.findUnique({ where: { id: params.id }, include: { job: JOB, resource: { select: { name: true } } } });
  if (!roleTarget) return NextResponse.json({ error: "not found" }, { status: 404 });
  const roleLocked = await assertDateOpen(roleTarget.job.date.toISOString().slice(0, 10));
  if (roleLocked) return roleLocked;

  const assignment = await prisma.assignment.update({
    where: { id: params.id },
    data: { role: body.role ?? null },
    include: { resource: true },
  });
  await logBoardEdit(user, isoDay(roleTarget.job.date), "ROLE", `${roleTarget.resource.name} at ${siteName(roleTarget.job)}: ${roleTarget.role ?? "no role"} -> ${body.role ?? "no role"}`);
  sanitizeAssignment(assignment, user?.role ?? null);
  return NextResponse.json(assignment);
});

// DELETE /api/assignments/:id -> unassign (drag off / remove chip)
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const current = await prisma.assignment.findUnique({ where: { id: params.id }, include: { job: JOB, resource: { select: { name: true } } } });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(current.job.date.toISOString().slice(0, 10));
  if (locked) return locked;
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Keep forever (Ilies, 10 Nov 2026): the allocation row is deleted (costing reads the live rows) but never without a
  // full snapshot of it in BoardEdit, in the same transaction.
  await prisma.$transaction(async (tx) => {
    await writeLock(tx); // write lock first, then read what is removed (no deadlock with another writer)
    const row = await tx.assignment.findUniqueOrThrow({ where: { id: params.id }, include: ASSIGNMENT_FOR_SNAPSHOT });
    await tx.assignment.delete({ where: { id: params.id } });
    await logBoardRemoval(tx, user, isoDay(current.job.date), "REMOVE", `${current.resource.name} off ${siteName(current.job)}`,
      { v: 1, kind: "REMOVE", allocations: [allocationSnapshot(row)] });
  });
  return NextResponse.json({ ok: true });
});
