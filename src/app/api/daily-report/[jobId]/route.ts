import { NextRequest } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { reportResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/daily-report/:jobId -> { report } - the written daily site report for one job on one day (29 Oct 2026):
// site, crew and signed hours, hours by activity code, plant, delays with photos, dockets sent, the notes and
// photos. Manager+. No dollar figure (narrow DTO + money guard). Photos: /api/day-review/site-logs/photo.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ jobId: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  return reportResponse((await paramsP).jobId);
});
