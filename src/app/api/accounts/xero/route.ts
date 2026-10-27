import { NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { xeroStatus } from "@/lib/xero/live/service";

// GET /api/accounts/xero -> the live Xero connection's status for Accounts -> Accounts data (27 Oct 2026,
// Ilies: the Xero data and the invoice-to-job matching on Victoria's page). The same xeroStatus() as the
// Directors page: connected organisation, by whom, last read. Read-only; connecting / disconnecting stays
// the owner's (canConnect is false for everyone else). Never a token or a key.
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await xeroStatus(g.user));
});
