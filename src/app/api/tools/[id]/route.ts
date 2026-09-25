import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickTool } from "@/lib/pickTool";
import { withErrorHandling } from "@/lib/apiHandler";

export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  const tool = await prisma.tool.update({
    where: { id: params.id },
    data: pickTool(body) as any,
  });
  return NextResponse.json(tool);
});

export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.tool.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
