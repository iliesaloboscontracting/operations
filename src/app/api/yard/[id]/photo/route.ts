import { NextRequest, NextResponse } from "next/server";
import { guardOrYard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";
import { findYardJob } from "@/lib/yard/store";

// GET /api/yard/:id/photo?which=request|ready - a yard job's photos on /yard (4 Nov 2026):
// the supervisor's photo and the yard's "ready" photo. Managers and up, and the YARD login.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardOrYard("MANAGER");
  if (denied) return denied;
  const r = await findYardJob(params.id);
  const file = req.nextUrl.searchParams.get("which") === "ready" ? r?.readyPhotoFile : r?.photoFile;
  if (!r || !file) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await readPhoto(file).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(file), "Cache-Control": "private, max-age=86400" } });
});
