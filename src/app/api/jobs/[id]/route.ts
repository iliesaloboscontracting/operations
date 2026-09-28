import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";
import { sanitizeJobs } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";

// PATCH /api/jobs/:id -> update job fields
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  const current = await prisma.job.findUnique({ where: { id: params.id }, select: { date: true } });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const currentLocked = await assertDateOpen(current.date.toISOString().slice(0, 10));
  if (currentLocked) return currentLocked;
  if ("date" in body) {
    const targetLocked = await assertDateOpen(body.date);
    if (targetLocked) return targetLocked;
  }

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
      project: { select: { name: true, client: true, jobNo: true, address: true } },
      assignments: { include: { resource: true } },
    },
  });
  const { project, ...rest } = job;
  sanitizeJobs([rest], user?.role ?? null);

  return NextResponse.json({
    ...rest,
    ...liveJobFields({ title: job.title, client: job.client, siteCode: job.siteCode, siteAddress: job.siteAddress, project }),
  });
});

// DELETE /api/jobs/:id
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const current = await prisma.job.findUnique({ where: { id: params.id }, select: { date: true } });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(current.date.toISOString().slice(0, 10));
  if (locked) return locked;
  await prisma.job.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
