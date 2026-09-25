import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, hashPassword, MIN_PASSWORD, normaliseEmail, ROLES } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

const PUBLIC_FIELDS = {
  id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true,
} as const;

// GET /api/users -> all users (admin only). Never returns password hashes.
export const GET = withErrorHandling(async () => {
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const users = await prisma.user.findMany({ orderBy: { name: "asc" }, select: PUBLIC_FIELDS });
  return NextResponse.json(users);
});

// POST /api/users { name, email, role, password } -> create an account (admin only)
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("ADMIN");
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const email = normaliseEmail(String(body.email ?? ""));
  const role = String(body.role ?? "VIEWER");
  const password = String(body.password ?? "");

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a name and a valid email" }, { status: 400 });
  }
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { name, email, role, passwordHash: await hashPassword(password) },
    select: PUBLIC_FIELDS,
  });
  return NextResponse.json(user, { status: 201 });
});
