import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink } from "@/lib/dailyLog/store";
import { linkSafe } from "@/lib/dailyLog/rules";
import { addLinkPhoto, hideLinkPhoto, linkPhotoFile } from "@/lib/dailyLog/beforeAfterLink";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";

// Before and after site photos from a supervisor's (or hand-over) link (30 Oct 2026). Rides the photos tunnel's
// api/site/.* route. Not on the daily log -> 404, as the log itself.
// POST { jobId, phase: "BEFORE" | "AFTER", photo: <data URL> } -> 201 { photos } - saved straight away; 403 for a job
//      the link can't log today, 409 at 6 in the set or once the day is closed.
// POST { hide: <photo id> } -> { photos } - the photo is hidden (who and when kept), never deleted.
// GET  ?id=<photo id> -> the image, only for a job the link can log today.
// Names and times only in every reply (linkSafe); no AI reading, no outside call.
async function linkFor(token: string) {
  const link = await resolveLink(token);
  if (!link || !(await isPilotLink(link))) return { res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  return { link };
}
const safe = (body: unknown, status = 200) =>
  linkSafe(body) ? NextResponse.json(body, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const { link, res } = await linkFor((await paramsP).token);
  if (!link) return res;
  const file = await linkPhotoFile(link, req.nextUrl.searchParams.get("id"), new Date());
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readPhoto(file).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mediaTypeOf(file), "Cache-Control": "private, max-age=3600" } });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const { link, res } = await linkFor((await paramsP).token);
  if (!link) return res;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const hiding = "hide" in b;
  const out = hiding ? await hideLinkPhoto(link, b.hide, new Date()) : await addLinkPhoto(link, b, new Date());
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return safe(out, hiding ? 200 : 201);
});
