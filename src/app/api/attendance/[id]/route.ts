import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { applyOfficeChange } from "@/lib/attendanceEdits";
import { syncSignInActualsQuietly } from "@/lib/signInActuals";

// PATCH /api/attendance/:id { signInAt?, signOutAt? (null = clear), status?, reason }
// Only the office (Manager+) changes a sign-in - rules in lib/attendanceEdits.ts.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return bad("Say why it's being changed.");
  const a = await prisma.siteAttendance.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const out = await applyOfficeChange(a, body, reason, user?.name ?? "Office");
  if ("error" in out) return bad(out.error);
  if (!out.changed) return NextResponse.json({ ok: true, unchanged: true });
  await syncSignInActualsQuietly([a.jobId]);
  return NextResponse.json({ ok: true });
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
