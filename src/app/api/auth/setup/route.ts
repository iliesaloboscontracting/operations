import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, MIN_PASSWORD, normaliseEmail, startSession } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// GET  /api/auth/setup -> { needsSetup: boolean }  (true until the first admin exists)
export const GET = withErrorHandling(async () => {
  return NextResponse.json({ needsSetup: (await prisma.user.count()) === 0 });
});

// POST /api/auth/setup { name, email, password } -> creates the first ADMIN and signs in.
// Refuses once any user exists, so it can't be used to take over an existing install.
export const POST = withErrorHandling(async (req: NextRequest) => {
  if ((await prisma.user.count()) > 0) {
    return NextResponse.json({ error: "Setup is already complete" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = normaliseEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter your name and a valid email" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password), role: "ADMIN", lastLoginAt: new Date() },
  });
  await startSession(user.id);
  return NextResponse.json({ ok: true }, { status: 201 });
});
