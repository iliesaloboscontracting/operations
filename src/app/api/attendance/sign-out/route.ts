import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { applyOfficeChange } from "@/lib/attendanceEdits";
import { parseTime } from "@/lib/signin";
import { syncSignInActualsQuietly } from "@/lib/signInActuals";

// POST /api/attendance/sign-out { ids: [...], signOutAt, reason } - the office
// signing several people out at once at the same time (24 Oct 2026), e.g. a
// crew that forgot. Same rules and history as changing them one by one
// (lib/attendanceEdits.ts). Only sign-ins with no sign-out yet are touched;
// anything that can't be changed is listed back with the reason.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return bad("Say why they're being signed out.");
  const at = parseTime(body.signOutAt);
  if (!at) return bad("Pick the sign-out time.");
  if (at.getTime() > Date.now() + 5 * 60_000) return bad("That time hasn't happened yet.");
  const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 200) : [];
  if (!ids.length) return bad("Pick who to sign out.");

  const rows = await prisma.siteAttendance.findMany({ where: { id: { in: ids } } });
  const done: string[] = [];
  const problems: { name: string; error: string }[] = [];
  for (const a of rows) {
    if (a.signOutAt) {
      problems.push({ name: a.workerName, error: "already signed out" });
      continue;
    }
    if (a.status === "REJECTED") continue;
    const out = await applyOfficeChange(a, { signOutAt: at.toISOString() }, reason, user?.name ?? "Office");
    if ("error" in out) problems.push({ name: a.workerName, error: out.error });
    else done.push(a.id);
  }
  const jobIds = [...new Set(rows.filter((r) => done.includes(r.id)).map((r) => r.jobId))];
  if (jobIds.length) await syncSignInActualsQuietly(jobIds);
  return NextResponse.json({ signedOut: done.length, problems });
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
