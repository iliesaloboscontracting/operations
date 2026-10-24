import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";

// GET /api/site/:token/requests/:id/photo - a request's photo, for the link
// that sent it or the person it's been given to.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id }, select: { photoFile: true, siteLinkId: true, requestedById: true, assigneeId: true, audience: true } });
  const allowed =
    r &&
    (r.siteLinkId === link.id ||
      (!link.shared && link.person.id && (r.requestedById === link.person.id || (link.kind === "OFFICE" && r.assigneeId === link.person.id))));
  // Links only ever see operational requests (lib/siteRequests.ts LINK_WHERE).
  if (!r || !allowed || !r.photoFile || r.audience !== "OPERATIONAL") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await readPhoto(r.photoFile).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(r.photoFile), "Cache-Control": "private, max-age=86400" } });
});
