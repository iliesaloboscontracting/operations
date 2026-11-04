import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { sanitizeAssignment } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";
import { isoDay, logBoardEdit, siteName } from "@/lib/boardGuard/store";
import { offHiredBefore, offHireStop } from "@/lib/hireEstimate";
import { fmtDay } from "@/lib/dates";

// POST /api/assignments -> drag a resource onto a job
// body: { jobId, resourceId, role? }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  if (!body.jobId || !body.resourceId) {
    return NextResponse.json(
      { error: "jobId and resourceId are required" },
      { status: 400 }
    );
  }

  const job = await prisma.job.findUnique({ where: { id: body.jobId }, select: { date: true, title: true, shift: true } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(job.date.toISOString().slice(0, 10));
  if (locked) return locked;

  const resource = await prisma.resource.findUnique({
    where: { id: body.resourceId },
  });
  // Off-hired gear can't go on a day after it was called off (Ilies, 5 Nov 2026).
  if (resource && resource.type === "HIRE" && resource.category !== "LABOUR" && offHiredBefore(resource, isoDay(job.date))) {
    const stop = offHireStop(resource);
    return NextResponse.json(
      { error: `${resource.name} was off-hired${stop ? ` on ${fmtDay(stop, { weekday: "short", day: "numeric", month: "short" })}` : ""} - put it back on hire on the Hire page first.` },
      { status: 400 },
    );
  }

  const assignment = await prisma.assignment.upsert({
    where: {
      jobId_resourceId: { jobId: body.jobId, resourceId: body.resourceId },
    },
    create: {
      jobId: body.jobId,
      resourceId: body.resourceId,
      role: body.role ?? resource?.role ?? null,
    },
    update: {
      role: body.role ?? resource?.role ?? null,
    },
    include: { resource: true },
  });

  await logBoardEdit(user, isoDay(job.date), "ASSIGN", `${assignment.resource.name} -> ${siteName(job)}`);
  sanitizeAssignment(assignment, user?.role ?? null);
  return NextResponse.json(assignment, { status: 201 });
});
