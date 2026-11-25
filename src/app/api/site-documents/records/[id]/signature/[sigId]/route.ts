import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { AGENT_NO_FILES } from "@/lib/siteDocs/rules";
import { isAgent, recordSignaturePng } from "@/lib/siteDocs/office";
import { pngReply } from "@/lib/siteDocs/replies";

// GET -> one signature on a pre-start / toolbox talk (PNG) - Managers, Admins and the coordinator only, never a link,
// never the Building Agent login (403). A sandboxing CSP, nosniff, no-store.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; sigId: string }> }) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  if (isAgent(g.user)) return NextResponse.json({ error: AGENT_NO_FILES }, { status: 403 });
  const { id, sigId } = await paramsP;
  const png = await recordSignaturePng(id, sigId);
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
  return pngReply(png);
});