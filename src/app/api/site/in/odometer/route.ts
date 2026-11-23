import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readOdometerToken } from "@/lib/signin";
import { odometerCapFull, odometerFor } from "@/lib/receipts/store";
import { truckPrestartPending } from "@/lib/prestart/today";

// POST /api/site/in/odometer { token, dataUrl } | { token, skip: true } -> { id, message }
// The odometer photo after signing in on a truck's QR (Receipts R1). The token comes back from that
// sign-in (30 minutes) and ties the photo to it; a retake replaces the photo. "Can't now" is kept.
// Ilies, 23 Nov 2026: on the truck's first pre-start of the day there is no "Can't now" - a skip is refused while the
// pre-start is still required, unless the truck's odometer photos for the day are used up (never trapped on a limit).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const attendanceId = readOdometerToken(body?.token);
  if (!attendanceId) return NextResponse.json({ error: "That's timed out - send it with your next sign-in." }, { status: 401 });
  if (body?.skip === true && (await truckPrestartPending(attendanceId)) && !(await odometerCapFull(attendanceId))) {
    return NextResponse.json({ error: "First check of the day on this truck - take the odometer photo." }, { status: 409 });
  }
  const out = await odometerFor(attendanceId, body);
  // A 429 = the truck's odometer photos for the day are used up: the phone may go on without it (capFull).
  if ("error" in out) return NextResponse.json({ error: out.error, ...(out.status === 429 ? { capFull: true } : {}) }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
