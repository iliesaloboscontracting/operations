import { NextRequest, NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { listFaults } from "@/lib/prestart/store";

// GET /api/faults?status=OPEN|IN_HAND|FIXED|ALL&resource=<id> -> { faults, machines }
// Vehicle & plant faults (8 Nov 2026): Managers, Admins, the coordinator and the yard computer (guardFaults). Default:
// the open ones (Open + In hand). No money in any of it.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(await listFaults({ status: sp.get("status"), resourceId: sp.get("resource") }));
});
