import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { resolveSiteDocsLink, signSwms } from "@/lib/siteDocs/store";
import { dead, off, safe } from "@/lib/siteDocs/replies";

// POST { jobId, fileId, attendanceId | supervisor: true, understood: true, signature } -> 201 { signed } - one person
// signs the current SWMS of the job's project: picked from that job's sign-ins today (or the supervisor), ticked "I've
// read and understand this SWMS", finger signature. One a person a version (409 the second time); not the current
// version any more 409; someone not signed in on the job 400. No PATCH / PUT / DELETE - a signature is never changed.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink((await paramsP).token);
  if (!link) return dead();
  const read = await readJsonBody(req, "That's too big to send - clear the signature and sign again.");
  if ("denied" in read) return read.denied;
  const out = await signSwms(link, read.b);
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});