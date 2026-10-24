import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard, hashPassword, MIN_PASSWORD, ROLES } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";

// PATCH /api/users/:id { name?, role?, active?, password? } (admin only)
// Safety rules: you can't demote or deactivate yourself, the last active admin
// can't be removed, and only the owner (lib/owner.ts) can change the owner's account.
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const me = await getCurrentUser();

  const body = await req.json().catch(() => ({}));
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (isOwner(target.email) && !isOwner(me?.email)) {
    return NextResponse.json({ error: "Only Iliesa can change this account." }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();

  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    // Directors-only logins (25 Oct 2026): only the owner gives or takes away the DIRECTOR role.
    if ((body.role === "DIRECTOR") !== (target.role === "DIRECTOR") && !isOwner(me?.email)) {
      return NextResponse.json({ error: "Only Iliesa can change a Director login." }, { status: 403 });
    }
    data.role = body.role;
  }
  if (body.active !== undefined) data.active = Boolean(body.active);

  // Director access (24 Oct 2026): the company overview carries contract
  // values and every job's cost, so only the owner hands it out.
  if (body.directorAccess !== undefined && Boolean(body.directorAccess) !== target.directorAccess) {
    if (!isOwner(me?.email)) {
      return NextResponse.json({ error: "Only Iliesa can change director access." }, { status: 403 });
    }
    const role = (data.role as string | undefined) ?? target.role;
    if (body.directorAccess && (role === "TIMESHEETS" || role === "ACCOUNTS")) {
      return NextResponse.json({ error: "Timesheets and Accounts logins can't have director access" }, { status: 400 });
    }
    data.directorAccess = Boolean(body.directorAccess);
  }

  if (body.password !== undefined) {
    if (String(body.password).length < MIN_PASSWORD) {
      return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, { status: 400 });
    }
    data.passwordHash = await hashPassword(String(body.password));
  }

  const losesAdmin =
    target.role === "ADMIN" &&
    target.active &&
    ((data.role !== undefined && data.role !== "ADMIN") || data.active === false);
  if (losesAdmin) {
    if (target.id === me?.id) {
      return NextResponse.json({ error: "You can't demote or deactivate your own account" }, { status: 400 });
    }
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) {
      return NextResponse.json({ error: "There must be at least one active admin" }, { status: 400 });
    }
  }

  const user = await prisma.user.update({
    where: { id: params.id },
    data,
    select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true, directorAccess: true },
  });
  return NextResponse.json(user);
});
