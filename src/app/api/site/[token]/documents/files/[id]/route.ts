import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { safeFileName, siteDocsOn } from "@/lib/siteDocs/rules";
import { linkFile, resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { dead, fileReply, notFound, off } from "@/lib/siteDocs/replies";

// GET -> a plan / drawing (not archived) or the CURRENT SWMS of a project this link has a job on today, inline, with
// its real type (from its bytes), nosniff, a safe filename and a CSP that runs nothing. Another project's file, an
// archived or superseded one, or a made-up id -> 404. Rides the photos tunnel's api/site/.* route.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  if (!siteDocsOn()) return off();
  const { token, id } = await paramsP;
  const link = await resolveSiteDocsLink(token);
  if (!link) return dead();
  const f = await linkFile(link, id);
  if (!f) return notFound();
  const ext = f.mime === "application/pdf" ? "pdf" : f.mime === "image/png" ? "png" : "jpg";
  return fileReply(f.bytes, f.mime, safeFileName(f.title, ext));
});