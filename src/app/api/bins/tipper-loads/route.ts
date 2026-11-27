import { NextRequest, NextResponse } from "next/server";
import { guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeTipperLoads } from "@/lib/bins/tipperStore";

// GET /api/bins/tipper-loads?projectId=&vehicleId=&use=CLIENT|OURS&from=YYYY-MM-DD&to=YYYY-MM-DD&status=LOGGED|CANCELLED
//   -> tipper loads in the range (default the last 90 days) with photos and tip docket suggestions, our tippers and
//      client's loads by job (27 Nov 2026). The Bins page's own walls: Managers, Admins and the coordinator (view only);
//      every write is guard("MANAGER") in /api/bins/tipper-loads/[id] and /api/bins/tippers/[id]. No money.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const pick = (k: string) => q.get(k)?.slice(0, 40) || undefined;
  return NextResponse.json(await officeTipperLoads({ projectId: pick("projectId"), vehicleId: pick("vehicleId"), use: pick("use"), from: pick("from"), to: pick("to"), status: pick("status") }));
});
