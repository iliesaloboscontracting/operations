import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { BinError } from "@/lib/bins/store";
import { changeTipperLoad } from "@/lib/bins/tipperStore";

// PATCH /api/bins/tipper-loads/:id - one tipper load, Managers and Admins only (never the coordinator):
//   { action: "correct", reason, vehicleId?, projectId?, use?, contents?, contentsNote? }
//   { action: "cancel", reason }              - a wrong entry (kept, marked cancelled)
//   { action: "tip-confirm", receiptId }      - this is the load's tip docket (never automatic)
//   { action: "tip-reject", receiptId }       - that docket isn't this load's
// Nothing is deleted (there is no DELETE); every change is in its history (RecordChange) with the reason.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  try {
    const row = await changeTipperLoad((await paramsP).id, body && typeof body === "object" ? body : {}, user);
    return NextResponse.json({ ok: true, id: row.id, status: row.status });
  } catch (e) {
    if (e instanceof BinError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
