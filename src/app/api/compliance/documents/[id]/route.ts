import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnDocument } from "@/lib/compliance/store";

// POST /api/compliance/documents/:id { action: EDIT (fields) | ARCHIVE { reason } | RESTORE }. Accounts + Admins.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const out = await actOnDocument(g.user.name, (await params).id, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
