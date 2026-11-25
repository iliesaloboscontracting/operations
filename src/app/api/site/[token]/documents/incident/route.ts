import { NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { siteDocsOn } from "@/lib/siteDocs/rules";
import { resolveSiteDocsLink } from "@/lib/siteDocs/store";
import { sendIncident } from "@/lib/siteDocs/incidents";
import { dead, off, safe } from "@/lib/siteDocs/replies";

// POST an incident report { jobId, type, treatment, bodyPart, occurredAt (YYYY-MM-DDTHH:MM Sydney), location,
// people: [attendanceId], others?, whatHappened, immediateAction, witnesses?, serious, promptShown, safeworkCalled?,
// photoIds: [], signature } -> 201 { incident: { number, day, type, sentAt } } - and that is ALL the link ever gets
// back about it. The owner's phone gets "Incident report INC-0004 sent - <project> (<supervisor>)". Immutable: no GET
// of a report on a link, no PATCH / PUT / DELETE.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!siteDocsOn()) return off();
  const link = await resolveSiteDocsLink((await paramsP).token);
  if (!link) return dead();
  const read = await readJsonBody(req, "That report is too big to send - call the office.");
  if ("denied" in read) return read.denied;
  const out = await sendIncident(link, read.b);
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});