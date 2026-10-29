import { NextRequest } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { photoResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/directors/daily-report/photo?log=<id>&file=<name> - a daily log photo for the directors' copy of the
// report (guardDirector; the office's is /api/day-review/site-logs/photo). Only a file that log holds.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  return photoResponse(req.nextUrl.searchParams.get("log"), req.nextUrl.searchParams.get("file"));
});
