import { NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { latestHireChecks } from "@/lib/hireCheck";

// GET /api/hire-checks -> each hire item's latest answer from the supervisor's
// hire check (24 Oct 2026), keyed by resource id. No money.
export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  return NextResponse.json({ checks: await latestHireChecks() });
});
