import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";

// GET /api/site/:token/requests/:id/photo - a request's photo, for the link
// that sent it or the person it's been given to.
// ?which=ready (yard jobs, 4 Nov 2026): the yard's "ready for collection" photo -
// only for the supervisor who asked (their link, or their own other link), never an
// office link. The yard's shared link has its own route (/yard/:id/photo).
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id }, select: { photoFile: true, readyPhotoFile: true, siteLinkId: true, requestedById: true, assigneeId: true, audience: true } });
  const ready = req.nextUrl.searchParams.get("which") === "ready";
  const requester = !!r && (r.siteLinkId === link.id || (!link.shared && !!link.person.id && r.requestedById === link.person.id));
  const allowed = ready
    ? requester && link.kind !== "OFFICE"
    : r &&
      (r.siteLinkId === link.id ||
        (!link.shared && link.person.id && (r.requestedById === link.person.id || (link.kind === "OFFICE" && r.assigneeId === link.person.id))));
  const file = ready ? r?.readyPhotoFile : r?.photoFile;
  // Links only ever see operational requests (lib/siteRequests.ts LINK_WHERE).
  if (!r || !allowed || !file || r.audience !== "OPERATIONAL") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await readPhoto(file).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(file), "Cache-Control": "private, max-age=86400" } });
});
