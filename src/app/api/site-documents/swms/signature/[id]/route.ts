import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { AGENT_NO_FILES } from "@/lib/siteDocs/rules";
import { isAgent, swmsSignaturePng } from "@/lib/siteDocs/office";
import { pngReply } from "@/lib/siteDocs/replies";

// GET -> one SWMS sign-on's finger signature (PNG) - Managers, Admins and the coordinator only, never a link, never the
// Building Agent login (403). Served so a browser can only show it as an image (a sandboxing CSP, nosniff, no-store).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  if (isAgent(g.user)) return NextResponse.json({ error: AGENT_NO_FILES }, { status: 403 });
  const png = await swmsSignaturePng((await paramsP).id);
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
  return pngReply(png);
});