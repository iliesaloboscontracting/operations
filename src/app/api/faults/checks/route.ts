import { NextRequest, NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { todaySydney } from "@/lib/today";
import { checksForDay } from "@/lib/prestart/store";

// GET /api/faults/checks?date=YYYY-MM-DD -> that Sydney day's truck sign-ins, each with its pre-start and post-check
// ("No pre-start" when there isn't one) and the answers. Managers, Admins, the coordinator and the yard computer.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  const d = req.nextUrl.searchParams.get("date");
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todaySydney();
  return NextResponse.json(await checksForDay(day));
});
