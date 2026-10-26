import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { linkableInvoices } from "@/lib/assets/store";

// GET /api/accounts/assets/invoices?q= -> invoices-inbox lines that can be linked as a service (last 12 months,
// not linked yet, not duplicates). The file opens through the inbox's own /api/invoice-inbox/uploads/:id.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ invoices: await linkableInvoices(req.nextUrl.searchParams.get("q") ?? "") });
});
