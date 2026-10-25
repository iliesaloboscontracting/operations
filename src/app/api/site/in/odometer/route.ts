import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readOdometerToken } from "@/lib/signin";
import { odometerFor } from "@/lib/receipts/store";

// POST /api/site/in/odometer { token, dataUrl } | { token, skip: true } -> { id, message }
// The odometer photo after signing in on a truck's QR (Receipts R1). The token comes back from that
// sign-in (30 minutes) and ties the photo to it; a retake replaces the photo. "Can't now" is kept.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const attendanceId = readOdometerToken(body?.token);
  if (!attendanceId) return NextResponse.json({ error: "That's timed out - send it with your next sign-in." }, { status: 401 });
  const out = await odometerFor(attendanceId, body);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
