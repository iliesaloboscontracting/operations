import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addTravelLeg } from "@/lib/travel/store";

// POST /api/attendance/travel { resourceId, jobId, direction: "OUT" | "HOME", startAt, endAt, mode, reason } - the office
// adds a travel leg by hand (24 Nov 2026): crew with "no driver found", or a worked-out leg that needs different times.
// It takes the place of the worked-out one. Like a correction: Manager+, a reason, kept in TravelEdit ("added by the
// office"); a locked (approved) week refuses it. Hours only.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return NextResponse.json({ error: "Say why it's being added." }, { status: 400 });
  const out = await addTravelLeg(body, reason, user?.name ?? "Office");
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
