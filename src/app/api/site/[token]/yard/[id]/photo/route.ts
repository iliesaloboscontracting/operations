import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";
import { isYardLink } from "@/lib/yard/rules";
import { findYardJob } from "@/lib/yard/store";

// GET /api/site/:token/yard/:id/photo?which=request|ready - a yard job's photos, on the
// yard's shared link only: the supervisor's own photo (what they need) and the yard's
// "ready" photo. Only jobs that are (or were) on the yard's list.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link || !isYardLink(link)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const r = await findYardJob(params.id);
  const file = req.nextUrl.searchParams.get("which") === "ready" ? r?.readyPhotoFile : r?.photoFile;
  if (!r || !file) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await readPhoto(file).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(file), "Cache-Control": "private, max-age=86400" } });
});
