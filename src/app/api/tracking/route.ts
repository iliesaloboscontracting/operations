import { NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadTracking } from "@/lib/trackingData";

// GET /api/tracking -> every non-archived project's cost to date, still to
// come, forecast and health, plus idle hire and the attention list. The maths
// lives in lib/trackingData.ts (shared with the Directors overview).
export const GET = withErrorHandling(async () => {
  // Individual pay rate and per-person labour cost are sensitive - this whole
  // page is Manager+ only, and even a Manager only gets project-level labour
  // totals (the per-person detail is ADMIN-only), not per-person lines.
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  return NextResponse.json(await loadTracking({ withPeople: user?.role === "ADMIN" }));
});
