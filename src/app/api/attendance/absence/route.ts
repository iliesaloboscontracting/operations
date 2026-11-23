import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { todaySydney } from "@/lib/today";
import { parseMark } from "@/lib/absence/rules";
import { markAbsence } from "@/lib/absence/store";

// POST /api/attendance/absence { resourceId, date, reason: SICK | NOT_IN, note? } - "Not in today" on the Sign-ins page
// (23 Nov 2026, Ilies: "yes build it, alex can too"): Managers, Admins and the coordinator (guardOrCoordinator - never
// by loosening guard()). Refused: Viewer, TIMESHEETS, ACCOUNTS, DIRECTOR, YARD and every site link (links only reach
// /api/site/*). One live mark per person per day; a locked timesheet week refuses. Information only - no hours, no money.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const parsed = parseMark(await req.json().catch(() => ({})), todaySydney());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const out = await markAbsence(parsed.value, user);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.id }, { status: 201 });
});
