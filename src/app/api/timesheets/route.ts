import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import {
  activeApproval, lineIssues, peopleOf, timesheetLines, weekDates, weekEnd, weekHasEnded, weekStartOf,
  type TimesheetSnapshot,
} from "@/lib/timesheets";

// GET /api/timesheets?week=YYYY-MM-DD (any date in the week) -> Lobos staff
// hours for that Monday-Sunday week from site sign-ins, the week's approval
// (if any), what changed since it was approved, and its approval history.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const [lines, approval, history] = await Promise.all([
    timesheetLines(weekStart),
    activeApproval(weekStart),
    prisma.timesheetWeek.findMany({
      where: { weekStart },
      orderBy: { approvedAt: "desc" },
      select: { id: true, approvedBy: true, approvedAt: true, totalHours: true, people: true, reopenedBy: true, reopenedAt: true, reopenReason: true },
    }),
  ]);
  // An approved week shows exactly what was approved; anything that differs
  // in the live sign-ins since then is listed so nothing slips by unseen.
  const approvedLines = approval ? (JSON.parse(approval.snapshot) as TimesheetSnapshot).lines : null;
  const shown = approvedLines ?? lines;
  const key = (l: { attendanceId: string; in: string; out: string | null; hours: number | null; status: string }) =>
    `${l.attendanceId}|${l.in}|${l.out}|${l.hours}|${l.status}`;
  const changedSinceApproval = approvedLines
    ? lines.filter((l) => !approvedLines.some((a) => key(a) === key(l))).length +
      approvedLines.filter((a) => !lines.some((l) => l.attendanceId === a.attendanceId)).length
    : 0;
  const issues = lines.filter((l) => lineIssues(l).length > 0).length;
  return NextResponse.json({
    weekStart,
    weekEnd: weekEnd(weekStart),
    days: weekDates(weekStart),
    today: todaySydney(),
    weekEnded: weekHasEnded(weekStart),
    people: peopleOf(weekStart, shown),
    totalHours: Math.round(shown.reduce((n, l) => n + (l.hours ?? 0), 0) * 4) / 4,
    issues,
    approval: approval && { approvedBy: approval.approvedBy, approvedAt: approval.approvedAt },
    changedSinceApproval,
    history,
  });
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
    const snapshot: TimesheetSnapshot = { weekStart, lines };
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
