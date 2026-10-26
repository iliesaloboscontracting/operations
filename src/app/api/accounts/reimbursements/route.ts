import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createClaim, listClaims } from "@/lib/reimbursements/store";

// Accounts -> Reimbursements (stage 3, docs/accounts/STAGE3-DESIGN.md). The ACCOUNTS login and Admins only.
// GET  -> claims to pay, recent paid / cancelled, receipts that could be claimed, the people.
// POST { receiptId, amountIncGst?, description? } | { resourceId, description, supplier?, refNo?, amountIncGst,
//      spentOn, photo? } -> a new claim; 409 with the matching claim(s) when it's already claimed.
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await listClaims());
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await createClaim({ id: g.user.id, name: g.user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error, duplicates: out.duplicates }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
