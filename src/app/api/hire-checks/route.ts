import { guardOrCoordinator } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { latestHireChecks } from "@/lib/hireCheck";

// GET /api/hire-checks -> each hire item's latest answer from the supervisor's
// hire check (24 Oct 2026), keyed by resource id. No money.
export const GET = withErrorHandling(async () => {
  const denied = await guardOrCoordinator("VIEWER");
  if (denied) return denied;
  return viewJson({ checks: await latestHireChecks() });
});
