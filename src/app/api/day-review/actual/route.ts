import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
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

  const job = await prisma.job.findUnique({ where: { id: body.jobId }, select: { date: true } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(job.date.toISOString().slice(0, 10));
  if (locked) return locked;

  const update: Record<string, unknown> = {};
  if ("attended" in body) update.attended = !!body.attended;
  if ("actualHours" in body) update.actualHours = body.actualHours === "" || body.actualHours == null ? null : Number(body.actualHours);
  if ("notes" in body) update.notes = body.notes || null;

  const actual = await prisma.jobActual.upsert({
    where: { jobId_resourceId: { jobId: body.jobId, resourceId: body.resourceId } },
    create: {
      jobId: body.jobId,
      resourceId: body.resourceId,
      attended: body.attended ?? true,
      actualHours: update.actualHours as number | null ?? null,
      notes: (update.notes as string | null) ?? null,
    },
    update,
  });
  return NextResponse.json(actual);
});

// DELETE /api/day-review/actual?jobId=&resourceId= -> remove an unplanned addition
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

  await prisma.jobActual.delete({ where: { jobId_resourceId: { jobId, resourceId } } }).catch(() => null);
  return NextResponse.json({ ok: true });
});
