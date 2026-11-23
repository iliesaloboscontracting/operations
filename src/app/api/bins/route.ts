import { NextRequest, NextResponse } from "next/server";
import { guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { binsSummary, officeBins } from "@/lib/bins/store";

// GET /api/bins?projectId=&use=CLIENT|OURS&from=YYYY-MM-DD&to=YYYY-MM-DD&status=PICKED_UP|CANCELLED
//   -> bins out now, the picked-up history (default the last 90 days), the register, fleet warnings, client bins by job
// GET /api/bins?summary=1 -> the "Bins out" card
// Managers and Admins, and the coordinator (Alex, view only - he tracks client bins as variations). Every write is
// guard("MANAGER") in /api/bins/[id] and /api/bins/register. No money on this page.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if (q.get("summary") === "1") return NextResponse.json(await binsSummary());
  const pick = (k: string) => q.get(k)?.slice(0, 40) || undefined;
  return NextResponse.json(await officeBins({ projectId: pick("projectId"), use: pick("use"), from: pick("from"), to: pick("to"), status: pick("status") }));
});
