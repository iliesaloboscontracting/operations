import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { BinError, addBin } from "@/lib/bins/store";

// POST /api/bins/register { size: M15|M11|M9|M8|HOOK, label? } - add a Lobos bin to the register (Managers and Admins).
// A blank label becomes "15 m³ (n)". Recorded in the bin's history.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  try {
    const row = await addBin(body?.size, body?.label, user);
    return NextResponse.json({ ok: true, id: row.id, label: row.label }, { status: 201 });
  } catch (e) {
    if (e instanceof BinError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
