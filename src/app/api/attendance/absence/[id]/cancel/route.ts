import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { parseCancel } from "@/lib/absence/rules";
import { cancelAbsence } from "@/lib/absence/store";

// POST /api/attendance/absence/:id/cancel { reason } - undo a "Not in today" mark (23 Nov 2026). The same people who
// mark (Managers, Admins, the coordinator). The mark is never deleted: it is kept with who undid it, when and why.
// A locked timesheet week refuses.
export const POST = withErrorHandling(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const parsed = parseCancel(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const out = await cancelAbsence(id, parsed.reason, user);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
