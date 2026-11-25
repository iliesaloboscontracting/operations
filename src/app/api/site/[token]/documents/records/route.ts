import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { resolveSiteDocsLink, sendRecord } from "@/lib/siteDocs/store";
import { dead, off, safe } from "@/lib/siteDocs/replies";

// POST a pre-start meeting { kind: PRESTART, jobId, topics: [{ key, notes }], notes?, crew: [{ attendanceId, understood,
// signature }], supervisorSignature } or a toolbox talk { kind: TOOLBOX, jobId, source: OFFICE | OWN, topicId?, title?,
// points, sitePoints?, notes?, crew, supervisorSignature } -> 201 { record } ("Pre-start 2" if it's the second).
// Locked once sent - late arrivals sign on with POST records/:id/sign. No PATCH / PUT / DELETE.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink((await paramsP).token);
  if (!link) return dead();
  const read = await readJsonBody(req, "That's too big to send - send it with fewer crew, then the rest sign on after.");
  if ("denied" in read) return read.denied;
  const out = await sendRecord(link, read.b);
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});