import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";
import { logPhotoFile } from "@/lib/dailyLog/store";

// GET /api/day-review/site-logs/photo?log=<id>&file=<name> - a photo from a
// daily log (the day, a delay or a tip docket), Viewer+ as Day Review. Only a
// file that log holds.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const file = await logPhotoFile(req.nextUrl.searchParams.get("log") ?? "", req.nextUrl.searchParams.get("file") ?? "");
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readPhoto(file).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(file), "Cache-Control": "private, max-age=86400" } });
});
