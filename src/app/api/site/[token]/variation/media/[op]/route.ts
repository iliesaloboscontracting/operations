import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOp, mediaPost } from "@/lib/media/routes";
import { mediaResponse } from "@/lib/media/serve";
import { mediaRef } from "@/lib/media/rules";
import { prisma } from "@/lib/prisma";
import { OFF_MESSAGE, variationsOn } from "@/lib/variations/rules";
import { resolveVariationLink } from "@/lib/variations/store";
import { variationMediaParty } from "@/lib/variations/media";

// Photos on a variation docket (25 Nov 2026) - the daily log's large-upload path (lib/media/protocol.ts), area
// VARIATION, photos only, from the same links as the docket (resolveVariationLink). Rides the photos tunnel's
// api/site/.* route.
// POST start    { jobId, kind: PHOTO, mime, size, sha256? } -> 201 { mediaId, put | parts... } (403 a job the link can't
//               do a docket for now, 415 a type it doesn't take, 429 the link's day caps)
// POST parts    { mediaId } -> resume / renew;  POST complete { mediaId } -> READY { ref: "media:<id>" } | 422 REJECTED
// GET  <media id> -> a redirect to a 5-minute signed read - only this link's own READY docket photo (the preview).
// Every reply: words, ids and addresses only - no money (lib/media/routes.ts replyOf).
const GONE = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
const OFF = () => NextResponse.json({ error: OFF_MESSAGE, off: true }, { status: 503 });

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; op: string }> }) => {
  const { token, op } = await paramsP;
  if (!isOp(op)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!variationsOn()) return OFF();
  const link = await resolveVariationLink(token);
  if (!link) return GONE();
  return mediaPost(req, op, variationMediaParty(link));
});

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; op: string }> }) => {
  const { token, op: id } = await paramsP;
  if (!variationsOn()) return OFF();
  const link = await resolveVariationLink(token);
  if (!link) return GONE();
  if (!/^[a-z0-9]{10,40}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await prisma.mediaObject.findUnique({ where: { id }, select: { siteLinkId: true, state: true, area: true } });
  if (!row || row.siteLinkId !== link.id || row.state !== "READY" || row.area !== "VARIATION") return NextResponse.json({ error: "not found" }, { status: 404 });
  return mediaResponse(mediaRef(id), req);
});
