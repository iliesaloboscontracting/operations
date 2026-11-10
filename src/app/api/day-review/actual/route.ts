import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { hideTracked, recordChanges } from "@/lib/history/store";
import { withErrorHandling } from "@/lib/apiHandler";
import { assertDateOpen } from "@/lib/dayLock";

// POST /api/day-review/actual { jobId, resourceId, attended?, actualHours?, notes? }
// Upserts a JobActual row: ticking/unticking attendance, editing actual
// hours, or adding an unplanned resource that wasn't on the original roster.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  if (!body.jobId || !body.resourceId) {
    return NextResponse.json({ error: "jobId and resourceId are required" }, { status: 400 });
  }

  const job = await prisma.job.findFirst({ where: { id: body.jobId, cancelledAt: null }, select: { date: true } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(job.date.toISOString().slice(0, 10));
  if (locked) return locked;
  const user = await getCurrentUser();

  const update: Record<string, unknown> = {};
  if ("attended" in body) update.attended = !!body.attended;
  if ("actualHours" in body) {
    update.actualHours = body.actualHours === "" || body.actualHours == null ? null : Number(body.actualHours);
    // Typed (or the "Use Xh" button): from now on it's someone's figure, so
    // sign-in corrections no longer change it.
    update.hoursSource = null;
  }
  if ("notes" in body) update.notes = body.notes || null;

  // Keep forever (10 Nov 2026): a removed row for this person on this job comes back (the key is unique); every field
  // that changed is kept in its history, in the same transaction as the save.
  const key = { jobId_resourceId: { jobId: body.jobId, resourceId: body.resourceId } };
  const actual = await prisma.$transaction(async (tx) => {
    const before = await tx.jobActual.findUnique({ where: key });
    if (before?.removedAt) Object.assign(update, { removedAt: null, removedBy: null, removeReason: null });
    const row = await tx.jobActual.upsert({
      where: key,
      create: {
        jobId: body.jobId,
        resourceId: body.resourceId,
        attended: body.attended ?? true,
        actualHours: update.actualHours as number | null ?? null,
        notes: (update.notes as string | null) ?? null,
      },
      update,
    });
    if (before) await recordChanges(tx, "JobActual", row.id, before, row, { by: user, source: "Day Review" }, Object.keys(update));
    return row;
  });
  return NextResponse.json(actual);
});

// DELETE /api/day-review/actual?jobId=&resourceId=&reason= -> remove an unplanned addition. Keep forever (Ilies,
// 10 Nov 2026): hidden (removedAt / By / Reason), never erased.
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const jobId = req.nextUrl.searchParams.get("jobId");
  const resourceId = req.nextUrl.searchParams.get("resourceId");
  if (!jobId || !resourceId) {
    return NextResponse.json({ error: "jobId and resourceId are required" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { date: true } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(job.date.toISOString().slice(0, 10));
  if (locked) return locked;

  const row = await prisma.jobActual.findUnique({ where: { jobId_resourceId: { jobId, resourceId } }, select: { id: true } });
  if (row) await hideTracked("JobActual", row.id, { by: await getCurrentUser(), reason: req.nextUrl.searchParams.get("reason") || "Removed from Day Review", source: "Day Review (remove)" });
  return NextResponse.json({ ok: true });
});
