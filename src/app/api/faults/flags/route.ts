import { NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { faultFlags } from "@/lib/prestart/store";

// GET /api/faults/flags -> { flags: { [resourceId]: { open, worst } } } for the board and the Vehicles register.
// Information only - never blocks or warns on an allocation.
export const GET = withErrorHandling(async () => {
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ flags: await faultFlags() });
});
