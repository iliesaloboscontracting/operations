import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { markHourMeterWrong } from "@/lib/prestart/plant";

// POST /api/faults/checks/:id/hour-meter { note } -> { ok }   (PS-019, 10 Nov 2026)
// "Reading wrong" on the Checks tab's Plant section: the plant check's hour-meter reading is marked wrong - who, when
// and why, kept as an event; nothing is deleted, and it's left out of "the last reading" for later checks. Managers and
// Admins only (Ilies, 10 Nov 2026: "Managers only") - the coordinator and the yard see the Checks tab but not this.
// Once only (409 after).
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const out = await markHourMeterWrong(params.id, body?.note, user?.name ?? "Office");
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
