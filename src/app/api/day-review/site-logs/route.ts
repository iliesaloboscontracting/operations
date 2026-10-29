import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { siteLogsForDate } from "@/lib/dailyLog/store";

// GET /api/day-review/site-logs?date=YYYY-MM-DD -> the pilot supervisors'
// daily logs for that date's jobs, for Day Review's "Site log" panel (Task K):
// the latest version and earlier ones, hours by code, delays, dockets, this
// week's progress, and the read-time checks (no log after 19:00, split no
// longer matching sign-ins, crew entered by hand). Read-only - opening it
// writes nothing. Viewer+ like Day Review; the hours-vs-budget tables
// (budget hours from Estimating) and the raw transcripts of the supervisor's
// recordings ("What was said", 30 Oct 2026) are for Managers and up only -
// a Viewer's reply has neither. The all-logs summary is for everyone who
// sees Day Review. No dollars.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date is required" }, { status: 400 });
  const user = await getCurrentUser();
  const office = !!user && (user.role === "MANAGER" || user.role === "ADMIN");
  return NextResponse.json(await siteLogsForDate(date, new Date(), office));
});
