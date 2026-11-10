import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { linkContext } from "@/lib/prestart/store";
import { prestartMediaParty } from "@/lib/prestart/media";
import { isOp, mediaRun, NOT_AN_UPLOAD, readSmallJson, replyOf } from "@/lib/media/routes";

// Large uploads on pre-starts (Ilies, 10 Nov 2026): a fault photo / video, a walk-around or hour-meter photo, straight to
// the private bucket. Rides the photos tunnel's api/site/.* route. The token (header x-prestart-token - PS-005, never the
// address) says which truck sign-in or plant session and which check, exactly as the photo route; every pre-start cap
// still applies (lib/prestart/media.ts).
// POST start    { kind: PHOTO | VIDEO, mime, size, slot?, sha256?, durationSec?, deviceId? } -> 201 { mediaId, put | parts }
//               (a 429 with capFull / cap = that day's allowance is full - PS-010, as the photo route)
// POST parts    { mediaId } -> resume / renew
// POST complete { mediaId } -> 200 { id } (the AssetFaultMedia id the check sends, as the photo route's) | 422 REJECTED
// Words and ids only - no money.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ op: string }> }) => {
  const { op } = await paramsP;
  if (!isOp(op)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readSmallJson(req);
  if (!body) return NOT_AN_UPLOAD();
  const ctx = await linkContext(req.headers.get("x-prestart-token"));
  if ("error" in ctx) return replyOf({ status: ctx.status, body: { error: ctx.error } });
  return mediaRun(op, prestartMediaParty(ctx, body.deviceId), body);
});
