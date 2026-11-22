import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser, guardTimesheetViewer } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { updateTracked } from "@/lib/history/store";
import {
  activeApproval, approvalBlockers, liveAbsences, liveTipRuns, liveTravel, timesheetLines, timesheetWeek, weekDates, weekHasEnded, weekStartOf,
  type TimesheetSnapshot,
} from "@/lib/timesheets";
import { flagSummaryForDays } from "@/lib/attendanceView";
import { coordinatorOr, rankAtLeast } from "@/lib/roles";
import { supervisorApprovals } from "@/lib/payroll/store";

// GET /api/timesheets?week=YYYY-MM-DD (any date in the week) -> Lobos staff
// hours for that Monday-Sunday week from site sign-ins, the week's approval
// (if any), what changed since it was approved, and its approval history.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardTimesheetViewer();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  // The Sign-ins page's flag counts for the week (10 Nov 2026) - for the office (Managers, Admins, the coordinator, who
  // all see the Sign-ins page), not the review-only TIMESHEETS login, which sees exactly what it saw before. PS-025: an allow-list (the Sign-ins
  // page's own rule, guardOrCoordinator("MANAGER")) - a role added later gets nothing until it's named here.
  // Information only: the approval rule is unchanged.
  const user = await getCurrentUser();
  const today = todaySydney();
  const signInFlags = user && coordinatorOr(user.role, "MANAGER") ? await flagSummaryForDays(weekDates(weekStart).filter((d) => d <= today)) : undefined;
  // Over a days-a-week limit (12 Nov 2026): the same office allow-list - information on the lines, approval unchanged.
  // Supervisors' "Approve hours" per line (18 Nov 2026, Ilies: Managers and Admins only - not the coordinator or the
  // review-only logins). Information only: the week's approval rule is unchanged.
  const supervisor = user && rankAtLeast(user.role, "MANAGER") ? (await supervisorApprovals(weekStart)).byLine : undefined;
  return viewJson({ ...(await timesheetWeek(weekStart, { dayLimit: !!signInFlags })), ...(signInFlags ? { signInFlags } : {}), ...(supervisor ? { supervisor } : {}) });
});

// POST /api/timesheets { week, action: "approve" | "reopen", reason? }
// Approve: Manager+, once the week has ended, every sign-in has a sign-out
// and is confirmed, and no regional travel leg is unended or over 8h. Reopen: Admin only, with a reason. Approvals are never
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
    const [lines, travel, tipRuns, absences] = await Promise.all([timesheetLines(weekStart), liveTravel(weekStart), liveTipRuns(weekStart), liveAbsences(weekStart)]);
    // Sign-ins with no sign-out or waiting for the supervisor, and (Ilies, 2 Nov 2026) regional travel never ended,
    // over 8h or still on the way, and (19 Nov 2026) regional tip runs never ended, over 6h or still on the go - all
    // sorted on the Sign-ins page first (lib/timesheets.ts approvalBlockers).
    const blockers = [...new Set(approvalBlockers(lines, travel, tipRuns))];
    if (blockers.length) {
      return bad(`Sort these out first on the Sign-ins page: ${blockers.slice(0, 6).join(", ")}${blockers.length > 6 ? "…" : ""}`);
    }
    // Regional travel (2 Nov 2026) and tip runs (19 Nov 2026) are locked in with the week, like the sign-ins - and the
    // Sick / Not in marks (23 Nov 2026, information only: never in the hours, never a blocker).
    const snapshot: TimesheetSnapshot = { weekStart, lines, travel, tipRuns, absences };
    await prisma.timesheetWeek.create({
      data: {
        weekStart,
        approvedBy: user?.name ?? "Office",
        snapshot: JSON.stringify(snapshot),
        // Worked hours: sign-ins + tip runs.
        totalHours: Math.round((lines.reduce((n, l) => n + (l.hours ?? 0), 0) + tipRuns.reduce((n, r) => n + (r.hours ?? 0), 0)) * 4) / 4,
        people: new Set([...lines.map((l) => l.resourceId), ...tipRuns.map((r) => r.resourceId)]).size,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reopen") {
    if (user?.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin can reopen an approved week." }, { status: 403 });
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (reason.length < 3) return bad("Say why the week is being reopened.");
    if (!current) return bad("This week isn't approved.");
    // Kept in the week's history too (keep forever, 10 Nov 2026) - each approval row is never overwritten again.
    await updateTracked("TimesheetWeek", current.id, { reopenedBy: user.name, reopenedAt: new Date(), reopenReason: reason }, { by: user, source: "Reopen timesheet week", reason });
    return NextResponse.json({ ok: true });
  }

  return bad("Unknown action.");
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
