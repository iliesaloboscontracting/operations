import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createTicket } from "@/lib/compliance/store";

// POST /api/compliance/tickets { resourceId, kind, label?, number?, issueDate?, expiryDate?, notes?, replacesId? }
// Accounts + Admins. replacesId = renewing: the old ticket is archived and its reminder cancelled.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const out = await createTicket(g.user.name, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
