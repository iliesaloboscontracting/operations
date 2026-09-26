import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";

// PATCH /api/jobs/:id -> update job fields
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  for (const key of [
    "title",
    "client",
    "siteCode",
    "siteAddress",
    "shift",
    "startTime",
    "endTime",
    "status",
    "dayBrief",
    "colorTag",
    "notRunning",
    "sortOrder",
  ]) {
    if (key in body) data[key] = body[key];
  }
  if ("date" in body) data.date = new Date(body.date);

  const job = await prisma.job.update({
    where: { id: params.id },
    data,
    include: {
      project: { select: { client: true, jobNo: true, address: true } },
      assignments: { include: { resource: true } },
    },
  });
  const { project, ...rest } = job;

  return NextResponse.json({
    ...rest,
    ...liveJobFields({ client: job.client, siteCode: job.siteCode, siteAddress: job.siteAddress, project }),
  });
});

// DELETE /api/jobs/:id
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.job.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
