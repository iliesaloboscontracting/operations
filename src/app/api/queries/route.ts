import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { queriesForUser } from "@/lib/findings/queries";

// GET /api/queries -> the questions asked of this login (accounts on her
// Invoices page, directors on Directors -> My queries): open ones, plus the
// last 14 days. Only ever this login's own (Phase 2, 25 Oct 2026).
export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ queries: await queriesForUser(user.id) });
});
