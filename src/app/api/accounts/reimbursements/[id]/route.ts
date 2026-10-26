import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnClaim } from "@/lib/reimbursements/store";

// POST /api/accounts/reimbursements/:id { action: "PAY", paidOn?, paidRef? } | { action: "CANCEL", reason }
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await actOnClaim({ id: g.user.id, name: g.user.name }, (await paramsP).id, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
