import { NextRequest, NextResponse } from "next/server";
import { guardXeroUpload } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { importXeroFile, recentImports } from "@/lib/xero/imports";
import { readJsonBody } from "@/lib/jsonBody";
import { UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";

// GET  /api/xero/imports -> recent Xero export uploads (G2, 25 Oct 2026).
// POST /api/xero/imports {dataUrl, originalName, kind: INVOICES|BILLS|PNL,
// asAt} -> reads one export into the Xero mirror. The ACCOUNTS login and
// director access only (guardXeroUpload) - never Managers or links.
// 7 MB a file; a body too big to read (over Next's 10 MB limit) is 413 "Too large (7 MB per file)" (2 Nov 2026).
export const GET = withErrorHandling(async () => {
  const g = await guardXeroUpload();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ imports: await recentImports() });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardXeroUpload();
  if ("denied" in g) return g.denied;
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const r = await importXeroFile(read.b, g.user);
  if ("status" in r && typeof r.status === "number") return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
