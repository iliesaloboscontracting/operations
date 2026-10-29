import { NextRequest } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { daysResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/directors/daily-report?projectId=<id> - the directors' copy of the job page's list of daily site reports
// (guardDirector: directors have no Operations access). Read-only.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  return daysResponse(req.nextUrl.searchParams.get("projectId"));
});
