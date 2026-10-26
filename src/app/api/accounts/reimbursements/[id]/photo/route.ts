import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { receiptMimeOf } from "@/lib/receipts/files";
import { claimPhoto } from "@/lib/reimbursements/store";

// GET /api/accounts/reimbursements/:id/photo -> the claim's receipt photo (Accounts screen only).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const p = await claimPhoto((await paramsP).id);
  if (!p) return NextResponse.json({ error: "No photo." }, { status: 404 });
  return new NextResponse(new Uint8Array(p.bytes), { headers: { "Content-Type": receiptMimeOf(p.fileName), "Cache-Control": "private, max-age=86400" } });
});
