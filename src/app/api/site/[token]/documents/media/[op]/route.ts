import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOp, mediaPost } from "@/lib/media/routes";
import { mediaResponse } from "@/lib/media/serve";
import { mediaRef } from "@/lib/media/rules";
import { prisma } from "@/lib/prisma";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { incidentMediaParty } from "@/lib/siteDocs/media";
import { photoOnAReport } from "@/lib/siteDocs/incidents";
import { dead, notFound, off } from "@/lib/siteDocs/replies";

// Photos on an incident report (25 Nov 2026) - the large-upload path (lib/media/protocol.ts), area INCIDENT, photos
// only, from the same links (resolveSiteDocsLink). Rides the photos tunnel's api/site/.* route.
// POST start { jobId, kind: PHOTO, mime, size } | parts { mediaId } | complete { mediaId } -> READY { ref: "media:<id>" }
// GET <media id> -> this link's own READY incident photo (the preview while filling the report in) - and never once a
// sent report cites it: after Send only the owner and DIRECTOR logins see it.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; op: string }> }) => {
  const { token, op } = await paramsP;
  if (!isOp(op)) return notFound();
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink(token);
  if (!link) return dead();
  return mediaPost(req, op, incidentMediaParty(link));
});

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; op: string }> }) => {
  const { token, op: id } = await paramsP;
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink(token);
  if (!link) return dead();
  if (!/^[a-z0-9]{10,40}$/.test(id)) return notFound();
  const row = await prisma.mediaObject.findUnique({ where: { id }, select: { siteLinkId: true, state: true, area: true } });
  if (!row || row.siteLinkId !== link.id || row.state !== "READY" || row.area !== "INCIDENT") return notFound();
  if (await photoOnAReport(id)) return NextResponse.json({ error: "Sent with the report - the office has it." }, { status: 404 });
  return mediaResponse(mediaRef(id), req);
});