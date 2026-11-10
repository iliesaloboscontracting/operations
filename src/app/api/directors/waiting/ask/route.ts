import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { sendToIlies } from "@/lib/directorsWaiting/store";

// POST /api/directors/waiting/ask { key } -> "Send to Ilies" for a decision not made yet (a "not available yet" item):
// a one-to-one office-chat message to the owner, once a week per item. Director access only.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await sendToIlies(user, typeof body?.key === "string" ? body.key : "");
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
