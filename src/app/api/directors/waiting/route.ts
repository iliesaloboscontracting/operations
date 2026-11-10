import { NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadWaiting } from "@/lib/directorsWaiting/store";

// GET /api/directors/waiting -> "Waiting on you" (10 Nov 2026): the missing information only this director can give -
// questions to answer, approvals, contract values, decisions not made yet - grouped, oldest first, each with its one
// action. Director access only (guardDirector); contract values may show (directors already see them).
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  return NextResponse.json(await loadWaiting(user));
});
