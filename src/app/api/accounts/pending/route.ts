import { NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { pendingForAccounts } from "@/lib/accounts/store";

// GET /api/accounts/pending -> "Pending for me" on the Accounts screen: invoices waiting in the
// inbox, questions to accounts, sign-ins with no sign-out (payroll), and due dates / reminders.
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await pendingForAccounts());
});
