import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addFile } from "@/lib/compliance/store";

// POST /api/compliance/files { ticketId | documentId, dataUrl, originalName } -> a photo / PDF of the card or
// document, stored in COMPLIANCE_FILE_DIR. Accounts + Admins. Never reachable from a site link.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const out = await addFile(g.user.name, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
