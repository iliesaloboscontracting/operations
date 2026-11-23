import { NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { prestartToday } from "@/lib/prestart/today";

// GET /api/faults/today -> "Pre-starts today" (Ilies, 23 Nov 2026): each truck signed in today and each owned machine
// with a QR sticker or booked today, with its status, the counts and how many machines have no sticker yet. The same
// people as the Checks tab (guardFaults: Managers, Admins, the coordinator and the yard). Names and words only - no money.
export const GET = withErrorHandling(async () => {
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await prestartToday());
});
