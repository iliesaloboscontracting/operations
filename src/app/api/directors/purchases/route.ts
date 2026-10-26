import { NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { listForDirectors } from "@/lib/purchases/store";
import { PURCHASE_APPROVERS_NOTE } from "@/lib/purchases/rules";

// GET /api/directors/purchases -> checked requests to approve and the last 30 days decided. Director access
// sees them; only a DIRECTOR login that didn't ask can decide (cannotDecide says why not).
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  return NextResponse.json({ requests: await listForDirectors(user), note: PURCHASE_APPROVERS_NOTE });
});
