import { NextRequest } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { reportResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/directors/daily-report/:jobId - the directors' copy of the written daily site report (guardDirector).
// The same narrow, money-free report as the office's.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ jobId: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  return reportResponse((await paramsP).jobId);
});
