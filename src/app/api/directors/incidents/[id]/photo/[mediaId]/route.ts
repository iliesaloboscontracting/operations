import { NextRequest, NextResponse } from "next/server";
import { guardIncidents } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mediaResponse } from "@/lib/media/serve";
import { mediaRef } from "@/lib/media/rules";
import { incidentHasPhoto } from "@/lib/siteDocs/incidents";

// GET -> one of an incident report's photos (a no-store redirect to a 5-minute signed read) - only a photo that report
// cites, and only for the owner and DIRECTOR logins.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; mediaId: string }> }) => {
  const g = await guardIncidents();
  if ("denied" in g) return g.denied;
  const { id, mediaId } = await paramsP;
  if (!(await incidentHasPhoto(id, mediaId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return mediaResponse(mediaRef(mediaId), req);
});