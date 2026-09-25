import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";

// PATCH /api/jobs/:id -> update job fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    include: { assignments: { include: { resource: true } } },
  });

  return NextResponse.json(job);
}

// DELETE /api/jobs/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.job.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
