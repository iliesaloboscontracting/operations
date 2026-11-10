import { NextRequest, NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { markHourMeterWrong } from "@/lib/prestart/plant";

// POST /api/faults/checks/:id/hour-meter { note } -> { ok }   (PS-019, 10 Nov 2026)
// "Reading wrong" on the Checks tab's Plant section: the plant check's hour-meter reading is marked wrong - who, when
// and why, kept as an event; nothing is deleted, and it's left out of "the last reading" for later checks. The people
// who work the Checks tab (guardFaults): Managers, Admins, the coordinator and the yard computer. Once only (409 after).
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await markHourMeterWrong(params.id, body?.note, g.user.name);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
