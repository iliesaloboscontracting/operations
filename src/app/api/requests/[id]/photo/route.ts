import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";

// GET /api/requests/:id/photo - the photo sent with a site request (Manager+).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id }, select: { photoFile: true } });
  if (!r?.photoFile) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readPhoto(r.photoFile).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(r.photoFile), "Cache-Control": "private, max-age=86400" } });
});
