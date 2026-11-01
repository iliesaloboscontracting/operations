import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { editTravelLeg } from "@/lib/travel/store";

// PATCH /api/attendance/travel/:id { startAt?, endAt? (null = clear), reason } - the office corrects a regional travel
// leg (2 Nov 2026), like a sign-in: Manager+, a reason, kept in TravelEdit; a locked (approved) week refuses it.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return NextResponse.json({ error: "Say why it's being changed." }, { status: 400 });
  const out = await editTravelLeg(params.id, body, reason, user?.name ?? "Office");
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
