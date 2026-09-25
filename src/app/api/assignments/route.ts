import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/assignments -> drag a resource onto a job
// body: { jobId, resourceId, role? }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();

  if (!body.jobId || !body.resourceId) {
    return NextResponse.json(
      { error: "jobId and resourceId are required" },
      { status: 400 }
    );
  }

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

  return NextResponse.json(assignment, { status: 201 });
});
