import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { listWorkers } from "@/lib/compliance/store";

// Accounts stage 5: Labour-register workers with their ticket state and onboarding progress. Accounts + Admins.
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ workers: await listWorkers() });
});
