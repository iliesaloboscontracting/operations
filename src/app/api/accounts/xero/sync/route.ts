import { NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { syncXero } from "@/lib/xero/live/service";

// POST /api/accounts/xero/sync -> "Refresh now" from the Accounts screen: the same read-only syncXero() as
// the Directors page, under the same rule (at most every 15 minutes, one at a time). Not set up or not
// connected -> a plain answer, no call out.
export const POST = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const r = await syncXero({ name: g.user.name, userId: g.user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
