import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dummyHash, normaliseEmail, startSession, verifyPassword } from "@/lib/auth";
import { clearFailures, isLocked, recordFailure } from "@/lib/throttle";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/auth/login { email, password }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}|${email}`;
  if (isLocked(key)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Always run a hash comparison so timing doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !user.active || !ok) {
    recordFailure(key);
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  clearFailures(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(user.id);
  return NextResponse.json({ ok: true });
});
