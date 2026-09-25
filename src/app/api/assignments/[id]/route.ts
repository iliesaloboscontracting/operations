import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";

// PATCH /api/assignments/:id
//  - { role }  -> change the role for this job assignment
//  - { jobId } -> move the resource to another job (drag chip between rows)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();

  if (body.jobId) {
    const current = await prisma.assignment.findUnique({ where: { id: params.id } });
    if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (current.jobId === body.jobId) return NextResponse.json(current);

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
    return NextResponse.json(moved);
  }

  const assignment = await prisma.assignment.update({
    where: { id: params.id },
    data: { role: body.role ?? null },
    include: { resource: true },
  });
  return NextResponse.json(assignment);
}

// DELETE /api/assignments/:id -> unassign (drag off / remove chip)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.assignment.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
