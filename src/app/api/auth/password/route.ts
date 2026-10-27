import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword, MIN_PASSWORD, startSession, verifyPassword } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/auth/password { current, next } -> change your own password. SEC-001: every other session of yours stops
// working (sessionVersion bumped); this browser gets a fresh cookie so you stay signed in here.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (next.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `New password must be at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: me.id } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await startSession(me.id, me.email);
  return NextResponse.json({ ok: true });
});
