import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { recordList } from "@/lib/siteDocs/office";

// GET ?projectId=&kind=PRESTART|TOOLBOX -> the pre-start meetings and toolbox talks sent from the links, newest first
// (who ran it, how many crew signed, late sign-ons). Managers, Admins and the coordinator. Read only.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams;
  return NextResponse.json({ records: await recordList({ projectId: q.get("projectId")?.slice(0, 40) || undefined, kind: q.get("kind")?.slice(0, 20) || undefined }) });
});