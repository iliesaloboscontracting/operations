import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { BinError } from "@/lib/bins/store";
import { setTipperFlag } from "@/lib/bins/tipperStore";

// PATCH /api/bins/tippers/:vehicleId { tipper: true | false, reason? } - is this one of our tippers (27 Nov 2026)?
// Managers and Admins only (never the coordinator); owned, active vehicles only. Until it's set, a vehicle is a tipper
// when its name says "Tipper". Kept in the vehicle's own history (Resource, field "tipper").
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ ok: true, ...(await setTipperFlag((await paramsP).id, body && typeof body === "object" ? body : {}, user)) });
  } catch (e) {
    if (e instanceof BinError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
