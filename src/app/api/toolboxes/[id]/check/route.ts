import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { VisionNotConfigured } from "@/lib/toolVision";
import { runToolboxCheck } from "@/lib/toolboxCheckRun";

// POST /api/toolboxes/:id/check { photoIds } -> the saved check with its result.
// Reads the photo(s), compares with what should be in this toolbox and
// records the check. It changes no tool - moving a tool found in the wrong
// box, or marking one missing, is a separate step the person chooses.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.photoIds) ? body.photoIds.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0 || ids.length > 4) {
    return NextResponse.json({ error: "Add 1 to 4 photos of the toolbox laid out." }, { status: 400 });
  }
  const box = await prisma.toolbox.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!box) return NextResponse.json({ error: "That toolbox doesn't exist anymore." }, { status: 404 });
  const photos = await prisma.toolPhoto.findMany({ where: { id: { in: ids }, kind: "CHECK" }, select: { id: true, fileName: true } });
  if (photos.length !== ids.length) return NextResponse.json({ error: "One of the photos is missing - upload them again." }, { status: 400 });

  try {
    const ordered = ids.map((id) => photos.find((p) => p.id === id)!);
    const { check, result } = await runToolboxCheck(box.id, ordered, user?.name ?? null);
    return NextResponse.json({ id: check.id, createdAt: check.createdAt, photoIds: ids, result }, { status: 201 });
  } catch (e) {
    if (e instanceof VisionNotConfigured) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
});
