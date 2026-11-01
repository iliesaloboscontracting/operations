import { NextRequest } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { reportResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/daily-report/:jobId -> { report } - the written daily site report for one job on one day (29 Oct 2026):
// site, crew and signed hours, hours by activity code, plant, delays with photos, dockets sent, the notes and
// photos. Manager+, and the coordinator (view only, from Day Review - 2 Nov 2026), who like the directors' copy gets
// the shown before / after photos only. No dollar figure (narrow DTO + money guard). Photos: /api/day-review/site-logs/photo.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ jobId: string }> }) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const office = (await getCurrentUser())?.role !== "COORDINATOR";
  return reportResponse((await paramsP).jobId, { removed: office }); // removed before / after photos too (Manager+)
});
