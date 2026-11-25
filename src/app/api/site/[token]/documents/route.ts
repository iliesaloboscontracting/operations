import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { linkView, resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { dead, off, safe } from "@/lib/siteDocs/replies";

// Site documents on a phone (Ilies approved 25 Nov 2026) - a SUPERVISOR link, or a HANDOVER link on its own job
// (resolveSiteDocsLink; DRIVER, POSTER, OFFICE, the yard's shared link, a switched-off, expired or made-up link -> 404).
// GET -> its jobs today: the crew (that job's sign-ins, people only), the plans, the current SWMS and who's signed it,
//        today's pre-starts and this week's toolbox talks (who signed); the topic of the week; its own incident reports
//        - number, date and type ONLY. Every reply passes the money guard. SITE_DOCS=off -> 503 with plain words.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink((await paramsP).token);
  if (!link) return dead();
  return safe(await linkView(link));
});