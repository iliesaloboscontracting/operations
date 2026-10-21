import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { parseTime } from "@/lib/signin";
import { lockedWeekFor } from "@/lib/timesheets";

const STATUSES = ["CONFIRMED", "TO_CONFIRM", "REJECTED"];

// PATCH /api/attendance/:id { signInAt?, signOutAt? (null = clear), status?, reason }
// Only the office (Manager+) changes a sign-in. Every change is kept -
// before, after, why and who - in AttendanceEdit; nothing is overwritten
// without a trace and nothing is deleted.
export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return bad("Say why it's being changed.");
  const a = await prisma.siteAttendance.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (await lockedWeekFor(a.date)) return bad("That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its sign-ins can change.");

  const data: Record<string, unknown> = {};
  const edits: { field: string; before: string | null; after: string | null }[] = [];
  if ("signInAt" in body) {
    const t = parseTime(body.signInAt);
    if (!t) return bad("The sign-in time isn't valid.");
    if (t.getTime() !== a.signInAt.getTime()) {
      data.signInAt = t;
      edits.push({ field: "signInAt", before: a.signInAt.toISOString(), after: t.toISOString() });
    }
  }
  if ("signOutAt" in body) {
    const t = body.signOutAt === null || body.signOutAt === "" ? null : parseTime(body.signOutAt);
    if (body.signOutAt && !t) return bad("The sign-out time isn't valid.");
    if ((t?.getTime() ?? null) !== (a.signOutAt?.getTime() ?? null)) {
      data.signOutAt = t;
      data.signOutMethod = t ? "OFFICE" : null;
      edits.push({ field: "signOutAt", before: a.signOutAt?.toISOString() ?? null, after: t?.toISOString() ?? null });
    }
  }
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) return bad("Unknown status.");
    if (body.status !== a.status) {
      data.status = body.status;
      data.confirmedBy = `${user?.name ?? "Office"} (office)`;
      data.confirmedAt = new Date();
      edits.push({ field: "status", before: a.status, after: body.status });
    }
  }
  const signIn = (data.signInAt as Date | undefined) ?? a.signInAt;
  const signOut = "signOutAt" in data ? (data.signOutAt as Date | null) : a.signOutAt;
  if (signOut && signOut <= signIn) return bad("Sign-out must be after sign-in.");
  if (edits.length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const by = user?.name ?? "Office";
  await prisma.siteAttendance.update({
    where: { id: a.id },
    data: { ...data, edits: { create: edits.map((e) => ({ ...e, reason, editedBy: by })) } },
  });
  return NextResponse.json({ ok: true });
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
