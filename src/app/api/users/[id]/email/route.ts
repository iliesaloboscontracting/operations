import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { checkEmailChange } from "@/lib/userEmail";
import { saveUserEdit } from "@/lib/userEdit";

// POST /api/users/:id/email { email } - change a login's email. The owner only (Ilies, 27 Nov 2026: "Add 'change email'
// to Users"); every other Admin gets 403. Rules in lib/userEmail.ts. The login is signed out everywhere (sessionVersion)
// and the change is kept in UserEvent with the before and after.
export const POST = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const others = await prisma.user.findMany({ where: { id: { not: target.id } }, select: { id: true, email: true } });
  const check = checkEmailChange(me.email, target, body?.email, others);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const event = { userId: target.id, action: "EDIT" as const, changes: JSON.stringify({ email: [target.email, check.email] }), by: me.name, byUserId: me.id };
  // The change, the sign-out everywhere and its log entry are saved together, or not at all (SEC-002-R2). A clash with
  // a login saved in the meantime is the email's unique index (P2002 -> 409 in withErrorHandling).
  const user = await saveUserEdit(prisma, target.id, { email: check.email, sessionVersion: { increment: 1 } }, event,
    { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true, directorAccess: true });
  return NextResponse.json(user);
});
