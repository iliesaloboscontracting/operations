import { NextRequest, NextResponse } from "next/server";
import { guardVariations } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mediaResponse } from "@/lib/media/serve";
import { mediaRef } from "@/lib/media/rules";
import { docketHasPhoto } from "@/lib/variations/store";

// GET /api/variations/:id/photo/:mediaId -> one of the docket's photos (a no-store redirect to a 5-minute signed read of
// the checked object) - Managers, Admins and the coordinator only, and only a photo the docket itself cites.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; mediaId: string }> }) => {
  const g = await guardVariations();
  if ("denied" in g) return g.denied;
  const { id, mediaId } = await paramsP;
  if (!(await docketHasPhoto(id, mediaId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return mediaResponse(mediaRef(mediaId), req);
});
