import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { BinError, changeMovement } from "@/lib/bins/store";

// PATCH /api/bins/:id - one bin delivery / pick-up, Managers and Admins only (never the coordinator):
//   { action: "correct", reason, projectId?, use?, size?, binId?, contents?, contentsNote? }
//   { action: "cancel", reason }              - a wrong entry (kept, marked cancelled)
//   { action: "unpick", reason }              - a wrong pick-up back on site
//   { action: "tip-confirm", receiptId }      - this is the bin's tip docket (never automatic)
//   { action: "tip-reject", receiptId }       - that docket isn't this bin's
// Nothing is deleted (there is no DELETE); every change is in its history (RecordChange) with the reason.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  try {
    const row = await changeMovement((await paramsP).id, body && typeof body === "object" ? body : {}, user);
    return NextResponse.json({ ok: true, id: row.id, status: row.status });
  } catch (e) {
    if (e instanceof BinError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
