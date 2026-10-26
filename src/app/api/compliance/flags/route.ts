import { NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { expiredTicketFlags } from "@/lib/compliance/store";

// GET /api/compliance/flags -> { flags: { [resourceId]: { expired: [{ label, expiryDate }] } } } for the board.
// Managers and Admins. Information only - never blocks an allocation. Labels and dates only: no ticket
// numbers, files or onboarding details. Viewers get 403 (guard), so they never see compliance data.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  return NextResponse.json({ flags: await expiredTicketFlags() });
});
