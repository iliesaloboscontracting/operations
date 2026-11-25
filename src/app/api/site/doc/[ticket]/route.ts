import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readDocTicket } from "@/lib/signin";
import { safeFileName, siteDocsOn } from "@/lib/siteDocs/rules";
import { linkById, linkMayOpen } from "@/lib/siteDocs/store";
import { fileReply, notFound, off } from "@/lib/siteDocs/replies";

// SD-001 (Ilies approved 26 Nov 2026): GET /api/site/doc/<ticket> -> the file, inline, with its real type, nosniff, a
// safe name and a CSP. Rides the photos tunnel's api/site/.* route - no Cloudflare change - and the address never holds
// the link's secret. The ticket's signature and expiry (at most 15 minutes) are checked, then everything again: the
// link is still active and may use site documents, and the file is still current, not archived and on one of that
// link's projects today (a topic: still this week's). Anything else -> 404.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ ticket: string }> }) => {
  if (!siteDocsOn()) return off();
  const t = readDocTicket((await paramsP).ticket);
  if (!t) return notFound();
  const link = await linkById(t.linkId);
  if (!link) return notFound();
  const f = await linkMayOpen(link, t.kind, t.fileId);
  if (!f) return notFound();
  const ext = f.mime === "application/pdf" ? "pdf" : f.mime === "image/png" ? "png" : "jpg";
  return fileReply(f.bytes, f.mime, safeFileName(f.title, ext));
});