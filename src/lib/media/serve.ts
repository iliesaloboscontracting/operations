// Large uploads (10 Nov 2026) - showing one. Every route that shows a stored photo (Day Review, the daily site report
// and its directors' copy, before / after, /faults, a link's own uploads) does its own guard and its own "is this
// yours / this job's" check first, exactly as before; when the stored name is a bucket upload ("media:<id>") it then
// answers with a redirect to a signed, 5-minute GET of the checked version - ?download=1 for a "save as" with a plain
// file name. No address is logged; the redirect itself is never cached.
import { NextResponse } from "next/server";
import { prisma } from "../prisma";
import { downloadName, mediaIdOf, type MediaKind } from "./rules";
import { readUrl } from "./protocol";

export const isMediaName = (name: string | null | undefined) => !!name && mediaIdOf(name) !== null;

export async function mediaResponse(name: string, req?: { nextUrl: URL }): Promise<NextResponse> {
  const id = mediaIdOf(name);
  if (!id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const download = req?.nextUrl.searchParams.get("download") === "1";
  let file: string | null = null;
  if (download) {
    const row = await prisma.mediaObject.findUnique({ where: { id }, select: { kind: true, objectKey: true, createdAt: true } });
    if (row) file = downloadName(row.kind as MediaKind, row.objectKey.slice(row.objectKey.lastIndexOf(".") + 1), row.createdAt);
  }
  const url = await readUrl(id, { download: file }).catch(() => null);
  if (!url) return NextResponse.json({ error: "That photo or video can't be shown right now." }, { status: 404 });
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

// Which of these stored names are videos (for the office's DTOs - the page shows a player and a Download link).
export async function videoNames(names: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(names.map((n) => mediaIdOf(n)).filter((x): x is string => !!x))];
  if (!ids.length) return new Set();
  const rows = await prisma.mediaObject.findMany({ where: { id: { in: ids }, kind: "VIDEO" }, select: { id: true } });
  return new Set(rows.map((r) => `media:${r.id}`));
}
