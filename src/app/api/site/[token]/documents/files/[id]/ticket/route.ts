import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { makeDocTicket } from "@/lib/signin";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { linkMayOpen, resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { dead, notFound, off, safe } from "@/lib/siteDocs/replies";

// SD-001 (Ilies approved 26 Nov 2026): POST -> 201 { url } - a 10-minute ticket to open a plan or the current SWMS on this link, bound to the
// file and the link (HMAC with AUTH_SECRET, lib/signin.ts makeDocTicket). The url is /api/site/doc/<ticket> - it never
// carries the link's secret. Only what this link may open now (the same checks as the file itself); else 404.
export const POST = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  if (!siteDocsOn()) return off();
  const { token, id } = await paramsP;
  const link = await resolveSiteDocsLink(token);
  if (!link) return dead();
  if (!(await linkMayOpen(link, "F", id, new Date(), false))) return notFound();
  return safe({ url: `/api/site/doc/${makeDocTicket("F", id, link.id)}` }, 201);
});