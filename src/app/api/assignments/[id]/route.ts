import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { sanitizeAssignment } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";

// PATCH /api/assignments/:id
//  - { role }  -> change the role for this job assignment
//  - { jobId } -> move the resource to another job (drag chip between rows)
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
    const current = await prisma.assignment.findUnique({ where: { id: params.id }, include: { job: { select: { date: true } } } });
    if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (current.jobId === body.jobId) return NextResponse.json(current);

    const sourceLocked = await assertDateOpen(current.job.date.toISOString().slice(0, 10));
    if (sourceLocked) return sourceLocked;
    const targetJob = await prisma.job.findUnique({ where: { id: body.jobId }, select: { date: true } });
    if (!targetJob) return NextResponse.json({ error: "not found" }, { status: 404 });
    const targetLocked = await assertDateOpen(targetJob.date.toISOString().slice(0, 10));
    if (targetLocked) return targetLocked;

    // Already on the target job? Just drop the source so we don't violate the unique pair.
    const existing = await prisma.assignment.findUnique({
      where: { jobId_resourceId: { jobId: body.jobId, resourceId: current.resourceId } },
    });
    if (existing) {
      await prisma.assignment.delete({ where: { id: params.id } });
      return NextResponse.json(existing);
    }
    const moved = await prisma.assignment.update({
      where: { id: params.id },
      data: { jobId: body.jobId },
      include: { resource: true },
    });
    sanitizeAssignment(moved, user?.role ?? null);
    return NextResponse.json(moved);
  }

  const roleTarget = await prisma.assignment.findUnique({ where: { id: params.id }, include: { job: { select: { date: true } } } });
  if (!roleTarget) return NextResponse.json({ error: "not found" }, { status: 404 });
  const roleLocked = await assertDateOpen(roleTarget.job.date.toISOString().slice(0, 10));
  if (roleLocked) return roleLocked;

  const assignment = await prisma.assignment.update({
    where: { id: params.id },
    data: { role: body.role ?? null },
    include: { resource: true },
  });
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
  const current = await prisma.assignment.findUnique({ where: { id: params.id }, include: { job: { select: { date: true } } } });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(current.job.date.toISOString().slice(0, 10));
  if (locked) return locked;
  await prisma.assignment.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
