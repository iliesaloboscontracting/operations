import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { sanitizeAssignment } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";

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

  const job = await prisma.job.findUnique({ where: { id: body.jobId }, select: { date: true } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(job.date.toISOString().slice(0, 10));
  if (locked) return locked;

  const resource = await prisma.resource.findUnique({
    where: { id: body.resourceId },
  });

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

  sanitizeAssignment(assignment, user?.role ?? null);
  return NextResponse.json(assignment, { status: 201 });
});
