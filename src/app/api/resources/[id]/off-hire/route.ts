import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { backOnHire, offHireItem } from "@/lib/offHire/store";

// POST /api/resources/:id/off-hire { date, ref? } -> called off with the supplier (Ilies, 5 Nov 2026):
//   the hire cost stops on `date`, the item leaves the board after it, its off-hire request closes.
// DELETE -> back on hire (a mistake, or it's needed again).
// Managers, Admins and the coordinator - the same people who work the Hire register. No money in or out.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const { id } = await paramsP;
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await offHireItem(id, body && typeof body === "object" ? (body as Record<string, unknown>) : {}, user.name);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, closed: out.closed });
});

export const DELETE = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const { id } = await paramsP;
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const out = await backOnHire(id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
