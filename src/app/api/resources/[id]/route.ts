import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickResourceData } from "@/lib/resourceFields";

// PATCH /api/resources/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  const resource = await prisma.resource.update({
    where: { id: params.id },
    data: pickResourceData(body) as any,
  });
  return NextResponse.json(resource);
}

// DELETE /api/resources/:id -> soft delete (mark inactive) to keep assignment history
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.resource.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ ok: true });
}
