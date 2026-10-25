import { NextRequest, NextResponse } from "next/server";
import { guardXeroUpload } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { importXeroFile, recentImports } from "@/lib/xero/imports";

// GET  /api/xero/imports -> recent Xero export uploads (G2, 25 Oct 2026).
// POST /api/xero/imports {dataUrl, originalName, kind: INVOICES|BILLS|PNL,
// asAt} -> reads one export into the Xero mirror. The ACCOUNTS login and
// director access only (guardXeroUpload) - never Managers or links.
export const GET = withErrorHandling(async () => {
  const g = await guardXeroUpload();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ imports: await recentImports() });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardXeroUpload();
  if ("denied" in g) return g.denied;
  const r = await importXeroFile(await req.json(), g.user);
  if ("status" in r && typeof r.status === "number") return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
