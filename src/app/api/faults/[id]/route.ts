import { NextRequest, NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { updateFault } from "@/lib/prestart/store";

// PATCH /api/faults/:id { status?: IN_HAND | FIXED, note?, backToAvailable?, priority? } -> { ok, backToAvailable }
// The office works a fault: Open -> In hand -> Fixed (Fixed needs a note), a priority change, or a note. Conditional,
// so two people can't both apply one (409). Managers, Admins, the coordinator and the yard computer.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await updateFault(params.id, body && typeof body === "object" ? body : {}, g.user.name);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
