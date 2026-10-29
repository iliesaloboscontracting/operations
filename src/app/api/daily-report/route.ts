import { NextRequest } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { daysResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/daily-report?projectId=<id> -> { days: [{ jobId, date, shift, revision, submittedBy }] } - the days a
// project has a daily site log, newest first (the Tracking job page's list of reports). Manager+.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  return daysResponse(req.nextUrl.searchParams.get("projectId"));
});
