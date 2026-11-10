import { NextRequest } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { beforeAfterPhotoResponse } from "@/lib/dailyLog/reportResponses";

// GET /api/day-review/site-logs/before-after?job=<jobId>&id=<photo id> - a before / after site photo (30 Oct 2026)
// for Day Review and the office's daily site report. Manager+ (never a Viewer). Only a photo of that job - a removed
// one too, shown greyed out (SEC-BA-004). The coordinator (view only, 2 Nov 2026) gets a shown photo only, as the
// directors' copy does.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const office = (await getCurrentUser())?.role !== "COORDINATOR";
  return beforeAfterPhotoResponse(req.nextUrl.searchParams.get("job"), req.nextUrl.searchParams.get("id"), { allowRemoved: office }, req);
});
