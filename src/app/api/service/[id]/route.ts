import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickServiceRecord } from "@/lib/pickServiceRecord";

// PATCH /api/service/:id -> edit a service record
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const record = await prisma.serviceRecord.update({
    where: { id: params.id },
    data: pickServiceRecord(body) as any,
  });
  return NextResponse.json(record);
}

// DELETE /api/service/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.serviceRecord.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
