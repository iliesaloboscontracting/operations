// Weekly timesheets (21 Oct 2026, Ilies): Lobos staff hours for a Monday-to-
// Sunday week, built from site sign-ins (signed in to signed out, less the
// site's unpaid break - the same rule the Sign-ins page uses). Hire and
// subcontractor workers are left off; rejected sign-ins don't count. Times
// and hours only - never a dollar figure.
import { prisma } from "./prisma";
import { jobLabel, POINT_BREAK_MINUTES, signedHours, STILL_ON_HOURS, sydneyTime } from "./signin";
import { todaySydney } from "./today";

export type TimesheetIssue = "NO_SIGN_OUT" | "TO_CONFIRM";

export type TimesheetLine = {
  attendanceId: string;
  date: string;
  resourceId: string;
  name: string;
  role: string | null;
  site: string; // project / job, or Office / Yard / the truck
  point?: boolean;
  onSite?: boolean; // signed in within the last 20 hours and not out yet - not a missing sign-out // office / yard / truck sign-in rather than a project site
  in: string;
  out: string | null;
  breakMinutes: number;
  hours: number | null;
  status: string; // CONFIRMED | TO_CONFIRM
  allocated: boolean;
  changedByOffice: string | null; // "sign-out 3:30pm -> 4:00pm (forgot to sign out)"
};

export type TimesheetPerson = {
  resourceId: string;
  name: string;
  role: string | null;
  days: Record<string, TimesheetLine[]>;
  total: number;
  issues: number;
};

export type TimesheetSnapshot = { weekStart: string; lines: TimesheetLine[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(new Date(date + "T00:00:00.000Z").getTime() + n * 86_400_000));

// The Monday of the week a date falls in.
export function weekStartOf(date: string) {
  const day = new Date(date + "T12:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}
export const weekDates = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
export const weekEnd = (weekStart: string) => addDays(weekStart, 6);

const shortTime = (d: Date | null) => (d ? sydneyTime(d) : null);
const FIELD = { signInAt: "sign-in", signOutAt: "sign-out", status: "status" } as Record<string, string>;
const show = (field: string, v: string | null) =>
  v == null ? "none" : field === "status" ? v.toLowerCase().replace("_", " ") : shortTime(new Date(v)) ?? v;

// Every non-rejected staff sign-in for the week, as timesheet lines.
export async function timesheetLines(weekStart: string): Promise<TimesheetLine[]> {
  const rows = await prisma.siteAttendance.findMany({
    where: { date: { gte: weekStart, lte: weekEnd(weekStart) }, status: { not: "REJECTED" }, resource: { type: "PERSONNEL" } },
    orderBy: [{ workerName: "asc" }, { signInAt: "asc" }],
    include: {
      resource: { select: { id: true, name: true, role: true } },
      job: { select: { title: true, shift: true, project: { select: { name: true, unpaidBreakMinutes: true } } } },
      edits: { orderBy: { editedAt: "asc" } },
    },
  });
  return rows.map((a) => {
    const breakMinutes = a.job ? a.job.project?.unpaidBreakMinutes ?? 0 : POINT_BREAK_MINUTES;
    return {
      attendanceId: a.id,
      date: a.date,
      resourceId: a.resource!.id,
      name: a.resource!.name,
      role: a.resource!.role,
      site: a.job ? jobLabel(a.job) : a.placeLabel ?? a.place ?? "Sign-in point",
      point: !a.job,
      onSite: !a.signOutAt && Date.now() - a.signInAt.getTime() < STILL_ON_HOURS * 3_600_000,
      in: sydneyTime(a.signInAt)!,
      out: sydneyTime(a.signOutAt),
      breakMinutes,
      hours: signedHours(a.signInAt, a.signOutAt, breakMinutes),
      status: a.status,
      allocated: a.allocated,
      changedByOffice: a.edits.length
        ? a.edits.map((e) => `${FIELD[e.field] ?? e.field} ${show(e.field, e.before)} -> ${show(e.field, e.after)} (${e.reason})`).join("; ")
        : null,
    };
  });
}

export const lineIssues = (l: TimesheetLine): TimesheetIssue[] => [
  ...(l.out || l.onSite ? [] : (["NO_SIGN_OUT"] as const)),
  ...(l.status === "TO_CONFIRM" ? (["TO_CONFIRM"] as const) : []),
];

// One row per person with their lines by day and a weekly total.
export function peopleOf(weekStart: string, lines: TimesheetLine[]): TimesheetPerson[] {
  const byPerson = new Map<string, TimesheetPerson>();
  for (const l of lines) {
    const p = byPerson.get(l.resourceId) ?? {
      resourceId: l.resourceId, name: l.name, role: l.role,
      days: Object.fromEntries(weekDates(weekStart).map((d) => [d, [] as TimesheetLine[]])),
      total: 0, issues: 0,
    };
    (p.days[l.date] ??= []).push(l);
    p.total += l.hours ?? 0;
    p.issues += lineIssues(l).length;
    byPerson.set(l.resourceId, p);
  }
  return [...byPerson.values()].map((p) => ({ ...p, total: Math.round(p.total * 4) / 4 })).sort((a, b) => a.name.localeCompare(b.name));
}

// The current approval for a week (latest one that hasn't been reopened).
export function activeApproval(weekStart: string) {
  return prisma.timesheetWeek.findFirst({ where: { weekStart, reopenedAt: null }, orderBy: { approvedAt: "desc" } });
}

// Office changes to a sign-in on a date in an approved week are refused.
export async function lockedWeekFor(date: string) {
  const ws = weekStartOf(date);
  return (await activeApproval(ws)) ? ws : null;
}

export const weekHasEnded = (weekStart: string) => todaySydney() > weekEnd(weekStart);

// Spreadsheet for accounts: one line per sign-in, then each person's total.
export function timesheetCsv(weekStart: string, lines: TimesheetLine[], approval: { approvedBy: string; approvedAt: Date } | null) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
  const out: (string | number | null)[][] = [
    [`Lobos Contracting - staff timesheet, week ${weekStart} to ${weekEnd(weekStart)}`],
    [approval ? `APPROVED by ${approval.approvedBy} on ${approval.approvedAt.toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}` : "DRAFT - not approved yet"],
    [],
    ["Employee", "Role", "Date", "Day", "Site / place", "Sign in", "Sign out", "Unpaid break (min)", "Hours", "Status", "Notes"],
  ];
  for (const p of peopleOf(weekStart, lines)) {
    for (const d of weekDates(weekStart)) {
      for (const l of p.days[d] ?? []) {
        const notes = [
          ...lineIssues(l).map((i) => (i === "NO_SIGN_OUT" ? "No sign-out" : "Waiting for supervisor")),
          ...(l.hours === 0 ? ["Check: in and out within minutes"] : []),
          ...(l.allocated ? [] : ["Not on the allocation"]),
          ...(l.changedByOffice ? ["Office changed: " + l.changedByOffice] : []),
        ].join("; ");
        out.push([p.name, p.role, l.date, dayName(l.date), l.site, l.in, l.out, l.breakMinutes, l.hours, l.status === "CONFIRMED" ? "Confirmed" : "To confirm", notes]);
      }
    }
    out.push([p.name, p.role, "", "WEEK TOTAL", "", "", "", "", p.total, "", ""]);
  }
  return out.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
