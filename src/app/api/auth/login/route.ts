import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dummyHash, homeFor, normaliseEmail, startSession, verifyPassword, type Role } from "@/lib/auth";
import { clearFailures, clientIp, isLocked, MAX_PER_EMAIL, recordFailure } from "@/lib/throttle";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/auth/login { email, password }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  }

  // SEC-011: an address the caller can't choose, and the email on its own (attempts spread over many addresses).
  const key = `${clientIp(req.headers)}|${email}`;
  const emailKey = `email:${email.toLowerCase()}`;
  if (isLocked(key) || isLocked(emailKey, MAX_PER_EMAIL)) {
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
    recordFailure(emailKey);
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  clearFailures(key);
  clearFailures(emailKey);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(user.id, user.email);
  // Where to land: the limited roles go straight to their one page.
  return NextResponse.json({ ok: true, home: homeFor(user.role as Role) });
});
