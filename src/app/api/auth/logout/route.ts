import { NextResponse } from "next/server";
import { endSession, getCurrentUser, revokeSessions } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/auth/logout - signs out everywhere (SEC-001): every session of this user, on every device, stops working.
export const POST = withErrorHandling(async () => {
  const me = await getCurrentUser();
  if (me) await revokeSessions(me.id);
  await endSession();
  return NextResponse.json({ ok: true });
});
