import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { lateSignOn, resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { dead, off, safe } from "@/lib/siteDocs/replies";

// POST { attendanceId, understood: true, signature } -> 201 { record } - a late arrival signs on to a sent pre-start /
// toolbox talk on one of this link's jobs today: an added signature (marked late), never an edit of the record.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string; id: string }> }) => {
  if (!siteDocsOn()) return off();
  const { token, id } = await paramsP;
  const link = await resolveSiteDocsLink(token);
  if (!link) return dead();
  const read = await readJsonBody(req, "That's too big to send - clear the signature and sign again.");
  if ("denied" in read) return read.denied;
  const out = await lateSignOn(link, id, read.b);
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});