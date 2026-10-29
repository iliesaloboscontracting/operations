import { NextRequest } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { beforeAfterPhotoResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/directors/daily-report/before-after?job=<jobId>&id=<photo id> - a before / after site photo for the
// directors' copy of the daily site report (guardDirector; the office's is /api/day-review/site-logs/before-after).
// Only a shown photo of that job.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  return beforeAfterPhotoResponse(req.nextUrl.searchParams.get("job"), req.nextUrl.searchParams.get("id"));
});
