import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { moveToStaff } from "@/lib/attendanceEdits";
import { syncPersonDayQuietly, syncSignInActualsQuietly } from "@/lib/signInActuals";

// POST /api/attendance/:id/person { resourceId, reason } - fix 4 (2 Nov 2026): a hire sign-in that was really Lobos
// staff is moved onto that person (Manager+, a reason, kept in AttendanceEdit; locked weeks refuse).
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return NextResponse.json({ error: "Say why it's being moved." }, { status: 400 });
  if (typeof body.resourceId !== "string" || !body.resourceId) return NextResponse.json({ error: "Pick the staff member." }, { status: 400 });
  const a = await prisma.siteAttendance.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const login = user ? await prisma.user.findUnique({ where: { id: user.id }, select: { personnelId: true } }) : null;
  const out = await moveToStaff(a, body.resourceId, reason, user?.name ?? "Office", user ? { email: user.email, personnelId: login?.personnelId ?? null } : undefined);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  await syncSignInActualsQuietly([a.jobId]);
  await syncPersonDayQuietly(body.resourceId, a.date);
  return NextResponse.json(out);
});
