import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickResourceData } from "@/lib/resourceFields";
import { withErrorHandling } from "@/lib/apiHandler";

// PATCH /api/resources/:id
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  const resource = await prisma.resource.update({
    where: { id: params.id },
    data: pickResourceData(body) as any,
  });
  return NextResponse.json(resource);
});

// DELETE /api/resources/:id -> soft delete (mark inactive) to keep assignment history
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.resource.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ ok: true });
});
