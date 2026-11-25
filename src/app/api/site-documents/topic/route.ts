import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";
import { AGENT_NO_WRITE } from "@/lib/siteDocs/rules";
import { isAgent, setTopic, topicList } from "@/lib/siteDocs/office";

// GET -> this week, next week and the last 12 weeks' toolbox talk topics. POST { week (its Monday), title, points[],
// fileName?, dataUrl? (a PDF), keepFileId? } -> 201 - the topic of the week for every site (a new row; the newest for a
// week is the one used). Managers, Admins and the coordinator; never the Building Agent login (403).
export const GET = withErrorHandling(async () => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await topicList());
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  if (isAgent(g.user)) return NextResponse.json({ error: AGENT_NO_WRITE }, { status: 403 });
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const out = await setTopic(g.user, read.b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});