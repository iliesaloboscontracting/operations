import { NextRequest } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { weekStartOf } from "@/lib/timesheets";
import { rankAtLeast } from "@/lib/roles";
import { labourHireWeek } from "@/lib/labourHire/load";

// GET /api/timesheets/labour-hire?week=YYYY-MM-DD&company=<key>|all (11 Nov 2026, Ilies: "yes, view and export,
// Managers + Admins + Alex") -> the week's labour hire sign-ins (Monday-Sunday) grouped by company and worker: site,
// in / out, unpaid break and hours per line (the staff rule), totals per worker and company, the lines not finished and
// the Sign-ins page's flags, and the office's company-name mappings. Managers, Admins and the coordinator; never Viewer,
// TIMESHEETS, ACCOUNTS, DIRECTOR or YARD. View only - nothing here approves or locks. Hours only, never money.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const company = (req.nextUrl.searchParams.get("company") ?? "all").slice(0, 120);
  // Mapping company names: Managers and Admins only (the coordinator sees the list).
  return viewJson({ ...(await labourHireWeek(weekStart, company)), canMap: !!user && rankAtLeast(user.role, "MANAGER") });
});
