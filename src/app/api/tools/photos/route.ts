import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { PHOTO_KINDS, savePhoto } from "@/lib/toolPhotos";

// POST /api/tools/photos { kind, dataUrl } -> { id }
// Stores one tool photo. It isn't attached to a tool yet - registering the
// tool, reporting a fault or running a toolbox check attaches/uses it.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  if (!(PHOTO_KINDS as readonly unknown[]).includes(body.kind)) {
    return NextResponse.json({ error: "kind must be PLATE, CONDITION, FAULT or CHECK" }, { status: 400 });
  }
  const saved = await savePhoto(body.dataUrl);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
  const photo = await prisma.toolPhoto.create({
    data: { kind: body.kind, fileName: saved.fileName, takenBy: user?.name ?? null },
  });
  return NextResponse.json({ id: photo.id }, { status: 201 });
});
