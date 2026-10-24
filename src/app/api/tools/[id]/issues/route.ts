import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/tools/:id/issues { description, photoId?, notWorking? }
// Reports a fault. "Not working" also marks the tool Needs repair so it shows
// on the register; it stays in its toolbox until it's actually swapped.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return NextResponse.json({ error: "Write what's wrong with the tool." }, { status: 400 });
  const tool = await prisma.tool.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!tool) return NextResponse.json({ error: "That tool doesn't exist anymore." }, { status: 404 });

  let photoId: string | null = null;
  if (typeof body.photoId === "string" && body.photoId) {
    const photo = await prisma.toolPhoto.findUnique({ where: { id: body.photoId }, select: { id: true, toolId: true } });
    if (photo && (!photo.toolId || photo.toolId === tool.id)) {
      await prisma.toolPhoto.update({ where: { id: photo.id }, data: { toolId: tool.id } });
      photoId = photo.id;
    }
  }
  const issue = await prisma.toolIssue.create({
    data: { toolId: tool.id, description, photoId, reportedBy: user?.name ?? null },
  });
  if (body.notWorking) await prisma.tool.update({ where: { id: tool.id }, data: { condition: "Needs repair" } });
  return NextResponse.json(issue, { status: 201 });
});
