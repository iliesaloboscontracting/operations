import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addFile } from "@/lib/compliance/store";
import { readJsonBody } from "@/lib/jsonBody";
import { UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";

// POST /api/compliance/files { ticketId | documentId, dataUrl, originalName } -> a photo / PDF of the card or
// document, stored in COMPLIANCE_FILE_DIR. Accounts + Admins. Never reachable from a site link.
// 7 MB a file; a body too big to read (over Next's 10 MB limit) is 413 "Too large (7 MB per file)" (2 Nov 2026).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const out = await addFile(g.user.name, read.b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
