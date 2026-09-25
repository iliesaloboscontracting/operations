import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickProject } from "@/lib/pickProject";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  const project = await prisma.project.update({
    where: { id: params.id },
    data: pickProject(body) as any,
  });
  return NextResponse.json(project);
}

// Deleting a project keeps its past jobs (projectId set null); prefer archiving.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.project.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
