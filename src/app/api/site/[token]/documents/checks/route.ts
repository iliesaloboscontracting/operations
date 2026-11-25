import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { jobPrestarts, resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { dead, notFound, off, safe } from "@/lib/siteDocs/replies";

// GET ?jobId= -> the trucks and Lobos-owned machines booked on this job, with today's pre-start / post-check from the
// existing checks (who - first name -, when, how many faults). Read only, money-free.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink((await paramsP).token);
  if (!link) return dead();
  const rows = await jobPrestarts(link, req.nextUrl.searchParams.get("jobId") ?? "");
  if (!rows) return notFound();
  return safe({ machines: rows });
});