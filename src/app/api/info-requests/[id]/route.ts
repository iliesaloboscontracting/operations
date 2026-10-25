import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { canActOnFindings } from "@/lib/findings/actions";
import { decide } from "@/lib/infoRequests/store";

// POST /api/info-requests/:id {action: CLOSE (outcome?) | ASK (question) |
// DECLINE (reason) | NUDGE (note?) | REOPEN} -> owner + director access.
// Nudge only records a reminder the person sees on their banner - no alert.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canActOnFindings(user)) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const r = await decide((await params).id, await req.json(), { name: user.name, id: user.id });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
