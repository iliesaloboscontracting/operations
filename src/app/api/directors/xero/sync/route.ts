import { NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { syncXero } from "@/lib/xero/live/service";

// POST /api/directors/xero/sync -> "refresh now": reads Xero (read-only) into
// the mirror. Director access, at most every 15 minutes. Not set up or not
// connected -> a plain answer, no call out.
export const POST = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const r = await syncXero({ name: user.name, userId: user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
