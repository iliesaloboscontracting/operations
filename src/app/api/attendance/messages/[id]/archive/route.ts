import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { parseArchive } from "@/lib/signinMessages/rules";
import { archiveMessage } from "@/lib/signinMessages/store";

// POST /api/attendance/messages/:id/archive { reason? } - stop showing a message to crew (23 Nov 2026). The same people
// who write (Managers, Admins, the coordinator). Nothing is deleted: the message, who it was for and every "Got it" stay.
// There is no edit - archive and send a new one.
export const POST = withErrorHandling(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const parsed = parseArchive(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const out = await archiveMessage(id, parsed.reason, user);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
