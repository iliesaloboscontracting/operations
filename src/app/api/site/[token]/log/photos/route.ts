import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink } from "@/lib/dailyLog/store";
import { linkSafe } from "@/lib/dailyLog/rules";
import { addLinkPhoto, hideLinkPhoto, linkPhotoFile } from "@/lib/dailyLog/beforeAfterLink";
import { BEFORE_AFTER_LIMITS, PHOTO_TOO_BIG, parsePhase } from "@/lib/dailyLog/beforeAfter";
import { readCapped } from "@/lib/dailyLog/voiceBody";
import { mediaTypeOf, readPhoto } from "@/lib/toolPhotos";

// Before and after site photos from a supervisor's (or hand-over) link (30 Oct 2026). Rides the photos tunnel's
// api/site/.* route. Not on the daily log -> 404, as the log itself.
// POST ?phase=BEFORE|AFTER { jobId, photo: <data URL> } -> 201 { photos } - saved straight away; 403 for a job the link
//      can't log today, 409 at 6 in the set or once the day is closed, 429 at 40 a link a day (SEC-BA-001).
// POST { hide: <photo id> } (no phase) -> { photos } - the photo is hidden (who and when kept), never deleted.
// GET  ?id=<photo id> -> the image, only for a job the link can log today.
// Before the photo is read (SEC-BA-002): one upload at a time per link and set -> 429; a Content-Length over 9 MB ->
// 413 straight away; no Content-Length -> read byte-counted and stopped at 9 MB.
// Names and times only in every reply (linkSafe); no AI reading, no outside call.
const inProgress = new Set<string>(); // "<link id>|<phase>" with an upload being worked on (this server)
const ONE_AT_A_TIME = "One photo at a time - wait for the last one to finish.";
const HIDE_MAX = 4 * 1024; // a remove is a few dozen bytes

async function linkFor(token: string) {
  const link = await resolveLink(token);
  if (!link || !(await isPilotLink(link))) return { res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  return { link };
}
const safe = (body: unknown, status = 200) =>
  linkSafe(body) ? NextResponse.json(body, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

// The JSON body, never read past `max`: a declared length over it is refused unread; without one it's counted as read.
async function cappedJson(req: NextRequest, max: number): Promise<Record<string, unknown> | "TOO_BIG"> {
  const header = req.headers.get("content-length");
  const length = header == null || header === "" ? null : Number(header);
  if (length != null && (!Number.isFinite(length) || length > max)) return "TOO_BIG";
  const bytes = await readCapped(req.body, max);
  if (bytes === "TOO_BIG") return "TOO_BIG";
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

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
  const phase = parsePhase(req.nextUrl.searchParams.get("phase"));
  if (!phase) {
    // A remove.
    const b = await cappedJson(req, HIDE_MAX);
    if (b === "TOO_BIG") return NextResponse.json({ error: "That isn't a remove." }, { status: 413 });
    if (!("hide" in b)) return NextResponse.json({ error: "Before or after?" }, { status: 400 });
    const out = await hideLinkPhoto(link, b.hide, new Date());
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return safe(out, 200);
  }
  const key = `${link.id}|${phase}`;
  if (inProgress.has(key)) return NextResponse.json({ error: ONE_AT_A_TIME }, { status: 429 });
  inProgress.add(key);
  try {
    const b = await cappedJson(req, BEFORE_AFTER_LIMITS.maxRequestBytes);
    if (b === "TOO_BIG") return NextResponse.json({ error: PHOTO_TOO_BIG }, { status: 413 });
    const out = await addLinkPhoto(link, { jobId: b.jobId, photo: b.photo, phase }, new Date());
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return safe(out, 201);
  } finally {
    inProgress.delete(key);
  }
});
