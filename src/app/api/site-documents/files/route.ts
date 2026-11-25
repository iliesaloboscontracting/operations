import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";
import { AGENT_NO_WRITE } from "@/lib/siteDocs/rules";
import { isAgent, uploadFile } from "@/lib/siteDocs/office";

// POST { projectId, kind: PLAN | SWMS, title, fileName, dataUrl } -> 201 { file: { id, version } } - a plan / drawing
// (PDF, JPEG or PNG) or a SWMS (PDF - the next version; the old ones are kept, superseded). Checked by its own first
// bytes; 7 MB a file (413 above). Managers, Admins and the coordinator; never the Building Agent login (403).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  if (isAgent(g.user)) return NextResponse.json({ error: AGENT_NO_WRITE }, { status: 403 });
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const out = await uploadFile(g.user, read.b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});