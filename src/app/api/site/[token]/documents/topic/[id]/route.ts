import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { safeFileName, siteDocsOn } from "@/lib/siteDocs/rules";
import { resolveSiteDocsLink, topicFile } from "@/lib/siteDocs/store";
import { dead, fileReply, notFound, off } from "@/lib/siteDocs/replies";

// GET -> this week's toolbox talk topic PDF (the office's topic of the week), inline - any other topic 404.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  if (!siteDocsOn()) return off();
  const { token, id } = await paramsP;
  const link = await resolveSiteDocsLink(token);
  if (!link) return dead();
  const f = await topicFile(id);
  if (!f) return notFound();
  return fileReply(f.bytes, f.mime, safeFileName(f.title, "pdf"));
});