import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser, guardTimesheetViewer } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import {
  activeApproval, lineIssues, liveTravel, timesheetLines, timesheetWeek, weekHasEnded, weekStartOf,
  type TimesheetSnapshot,
} from "@/lib/timesheets";

// GET /api/timesheets?week=YYYY-MM-DD (any date in the week) -> Lobos staff
// hours for that Monday-Sunday week from site sign-ins, the week's approval
// (if any), what changed since it was approved, and its approval history.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardTimesheetViewer();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  return viewJson(await timesheetWeek(weekStart));
});

// POST /api/timesheets { week, action: "approve" | "reopen", reason? }
// Approve: Manager+, once the week has ended and every sign-in has a sign-out
// and is confirmed. Reopen: Admin only, with a reason. Approvals are never
// deleted - reopening marks the approval, re-approving adds a new one.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  if (typeof body.week !== "string" || !isISODate(body.week)) return bad("Pick the week.");
  const weekStart = weekStartOf(body.week);
  const current = await activeApproval(weekStart);

  if (body.action === "approve") {
    if (current) return bad("This week is already approved.");
    if (!weekHasEnded(weekStart)) return bad("The week hasn't finished yet - approve it from Monday.");
    const lines = await timesheetLines(weekStart);
    const open = lines.filter((l) => lineIssues(l).length > 0);
    if (open.length) {
      const names = [...new Set(open.map((l) => `${l.name} (${l.date})`))].slice(0, 6).join(", ");
      return bad(`Sort these out first on the Sign-ins page - no sign-out or waiting for the supervisor: ${names}${open.length > 6 ? "…" : ""}`);
    }
    // Regional travel (2 Nov 2026) is locked in with the week, like the sign-ins.
    const snapshot: TimesheetSnapshot = { weekStart, lines, travel: await liveTravel(weekStart) };
    await prisma.timesheetWeek.create({
      data: {
        weekStart,
        approvedBy: user?.name ?? "Office",
        snapshot: JSON.stringify(snapshot),
        totalHours: Math.round(lines.reduce((n, l) => n + (l.hours ?? 0), 0) * 4) / 4,
        people: new Set(lines.map((l) => l.resourceId)).size,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reopen") {
    if (user?.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin can reopen an approved week." }, { status: 403 });
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (reason.length < 3) return bad("Say why the week is being reopened.");
    if (!current) return bad("This week isn't approved.");
    await prisma.timesheetWeek.update({
      where: { id: current.id },
      data: { reopenedBy: user.name, reopenedAt: new Date(), reopenReason: reason },
    });
    return NextResponse.json({ ok: true });
  }

  return bad("Unknown action.");
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
