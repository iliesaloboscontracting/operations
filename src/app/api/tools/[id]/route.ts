import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickTool } from "@/lib/pickTool";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  const tool = await prisma.tool.update({
    where: { id: params.id },
    data: pickTool(body) as any,
  });
  return NextResponse.json(tool);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.tool.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
