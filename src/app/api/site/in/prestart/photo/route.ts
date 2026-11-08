import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { linkSafe } from "@/lib/receipts/rules";
import { linkContext, linkPhoto } from "@/lib/prestart/store";

// POST /api/site/in/prestart/photo { token, photo: dataUrl, deviceId? } -> { id }
// A fault photo from the pre-start / post-check screen (camera or gallery, shrunk on the phone first). Kept for that
// sign-in until the check is sent and attaches it to its fault. JPEG / PNG / WebP by their bytes, 6 MB, 20 a sign-in,
// 60 a phone a day, none once the check is in (lib/prestart/store.ts linkPhoto).
const reply = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const POST = withErrorHandling(async (req: NextRequest) => {
  const read = await readJsonBody(req, "That photo is too large - take it again.");
  if ("denied" in read) return read.denied;
  const ctx = await linkContext(read.b.token);
  if ("error" in ctx) return reply({ error: ctx.error }, ctx.status);
  const out = await linkPhoto(ctx, read.b.photo, read.b.deviceId);
  if ("error" in out) return reply({ error: out.error }, out.status);
  return reply(out, 201);
});
