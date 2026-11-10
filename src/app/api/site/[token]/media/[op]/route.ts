import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink } from "@/lib/dailyLog/store";
import { logMediaParty } from "@/lib/dailyLog/media";
import { isOp, mediaPost } from "@/lib/media/routes";
import { mediaResponse } from "@/lib/media/serve";
import { mediaRef } from "@/lib/media/rules";
import { prisma } from "@/lib/prisma";

// Large uploads on the daily site log (Ilies, 10 Nov 2026) - a supervisor's or hand-over link with the daily log only
// (as /log and /log/photos; not on the log -> 404). Rides the photos tunnel's api/site/.* route. The file itself goes
// straight from the phone to the private bucket with the signed addresses these hand out (lib/media/protocol.ts):
// POST start    { area: DAILY_LOG | DELAY | BEFORE_AFTER, jobId, phase?, kind: PHOTO | VIDEO, mime, size, sha256?, durationSec? }
//               -> 201 { mediaId, multipart, put | parts... } - 403 a job the link can't log today, 409 the day closed /
//               the set full, 413 too big / a video over 2 minutes, 415 a type it doesn't take, 429 a daily cap.
// POST parts    { mediaId } -> which parts the bucket has and addresses for the next ones (resume / renew).
// POST complete { mediaId } -> the server checks the object (size, first bytes, length) -> 200 READY { ref: "media:<id>",
//               photos? } | 422 REJECTED (kept, never shown) | 409 still missing parts.
// GET  <media id> -> a redirect to a 5-minute signed read - only this link's own READY upload (?download=1 to save).
// Every reply: words, ids and addresses only - no money (assertNoMoney).
async function linkFor(token: string) {
  const link = await resolveLink(token);
  if (!link || !(await isPilotLink(link))) return null;
  return link;
}
const GONE = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; op: string }> }) => {
  const { token, op } = await paramsP;
  if (!isOp(op)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const link = await linkFor(token);
  if (!link) return GONE();
  return mediaPost(req, op, logMediaParty(link));
});

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; op: string }> }) => {
  const { token, op: id } = await paramsP;
  const link = await linkFor(token);
  if (!link) return GONE();
  if (!/^[a-z0-9]{10,40}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await prisma.mediaObject.findUnique({ where: { id }, select: { siteLinkId: true, state: true } });
  if (!row || row.siteLinkId !== link.id || row.state !== "READY") return NextResponse.json({ error: "not found" }, { status: 404 });
  return mediaResponse(mediaRef(id), req);
});
