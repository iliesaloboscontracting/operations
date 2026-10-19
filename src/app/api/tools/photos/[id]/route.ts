import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";

// GET /api/tools/photos/:id -> the image itself, for anyone signed in.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const photo = await prisma.toolPhoto.findUnique({ where: { id: params.id }, select: { fileName: true } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readPhoto(photo.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": mediaTypeOf(photo.fileName), "Cache-Control": "private, max-age=86400" },
  });
});
