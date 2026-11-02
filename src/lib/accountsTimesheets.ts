// Timesheets on the Accounts screen (2 Nov 2026, Ilies: "accounts dash needs access to the time sheets no changes
// just export button for her pay roll ... a notification that comes up once that explains how the time sheets work
// including the break deductions"). View only: the same week as /timesheets, read through guardAccounts() at
// /api/accounts/timesheets. Nothing here writes a timesheet, a sign-in or an approval - those routes stay
// guard("MANAGER") / guard("ADMIN") and refuse the ACCOUNTS login. The only write is the "Got it" on the notice.
import { prisma } from "./prisma";
import { POINT_BREAK_MINUTES, STILL_ON_HOURS } from "./signin";
import { timesheetCsv, type TimesheetLine, type TravelLine } from "./timesheets";
import { fileIsSafe } from "./payroll/rules";
import { HOME_OFFER_HOURS, TRAVEL_CAP_HOURS } from "./travel/rules";
import { BREAK_OVER_MINUTES } from "./dayHours";

// ---------- the one-time notice ----------

// Bump the version when the text changes in a way she should read again.
// V2 (2 Nov 2026): the break rule changed to once a day over 5 h - she sees the notice again.
export const TIMESHEETS_NOTICE = "ACCOUNTS_TIMESHEETS_V2";

// New projects start with a 30-minute unpaid break (prisma/schema.prisma Project.unpaidBreakMinutes @default(30);
// the project form's placeholder, lib/projectFormFields.ts). Not importable from the schema, so it is stated here.
const PROJECT_BREAK_DEFAULT = 30;

export type ExplainerSection = { heading: string; bullets: string[] };

// The words, in one place, for the owner to check. Every rule is from the code - sources are noted per section.
export type Explainer = { title: string; intro: string; sections: ExplainerSection[] };
export const TIMESHEETS_EXPLAINER: Explainer = {
  title: "How timesheets work",
  intro: "These are the Lobos staff hours for the week, straight from the crew's sign-ins. You can look and export - you can't change anything here.",
  sections: [
    {
      // lib/signin.ts (QR / poster / fixed points); lib/timesheets.ts timesheetLines (PERSONNEL only)
      heading: "Where the hours come from",
      bullets: [
        "Each worker signs in and out on their phone: the supervisor's QR on site, a site poster, or the fixed QR at the office, yard or a truck.",
        "Only Lobos staff on the Labour register are on timesheets. Labour hire and subcontract workers are on Payroll.",
      ],
    },
    {
      // lib/dayHours.ts (BREAK_OVER_MINUTES, the day merge, the break off the longest line, quarter-hour rounding);
      // lib/signin.ts POINT_BREAK_MINUTES; lib/timesheets.ts timesheetLines / peopleOf (Ilies, 2 Nov 2026: "break once per day over 5h")
      heading: "How hours are worked out",
      bullets: [
        `Hours = sign-out time minus sign-in time. One unpaid break per person per day, and only when their day's total is over ${BREAK_OVER_MINUTES / 60} hours.`,
        `The break is the largest set on any of that day's places: each project's own setting (new projects start at ${PROJECT_BREAK_DEFAULT} minutes), and ${POINT_BREAK_MINUTES} minutes at the office, yard and trucks. It comes off the day's longest sign-in.`,
        "Signed in at two places at the same time (a truck and a site, say)? That time counts once, and both lines show \"overlap - counted once\".",
        "Hours never go below zero. Each line is rounded to the nearest quarter hour, so the lines add up to the day; week totals are rounded to the quarter hour too.",
      ],
    },
    {
      // lib/signin.ts signedHours (null with no sign-out), STILL_ON_HOURS; lib/timesheets.ts lineIssues; lib/accounts/store.ts pendingForAccounts
      heading: "No sign-out",
      bullets: [
        "A sign-in with no sign-out counts no hours until the office puts in the sign-out time. It shows as \"no sign-out\".",
        `Someone signed in within the last ${STILL_ON_HOURS} hours shows as \"on site now\" instead.`,
        "Your To do lists the sign-ins from the last 2 weeks that never signed out.",
      ],
    },
    {
      // lib/travel/rules.ts (legHours, TRAVEL_CAP_HOURS, HOME_OFFER_HOURS, outRefusal); lib/travel/store.ts (regional jobs
      // only, endOutOnSignIn, startHome / arrive, editTravelLeg); lib/timesheets.ts (Travel column); lib/payroll/rules.ts TRAVEL_HOOK
      heading: "Travel (regional jobs)",
      bullets: [
        "Only for jobs on a project marked Regional - local jobs are exactly as before. Travel is its own column and is never added to site hours.",
        "Travel out: the worker taps Start travel on their phone; it ends when they sign in on site at that project. A phone can start travel after its owner signs in on a supervisor's QR on a regional job they're allocated to.",
        `Travel home: after signing out of a regional job they tap Travelling home (offered for ${HOME_OFFER_HOURS} hours after the sign-out), then Arrived.`,
        `Travel hours = start to end, to the nearest quarter hour, with no break taken off. A leg never ended, or longer than ${TRAVEL_CAP_HOURS} hours, counts no hours and is flagged - only the office can correct it, with a reason. Until it's fixed, the Manager can't approve that week.`,
        "How travel is paid is still to be agreed - the exports show the travel hours only.",
      ],
    },
    {
      // app/api/attendance/[id]/route.ts PATCH (Manager+, reason); lib/attendanceEdits.ts; lib/timesheets.ts changedByOffice; lib/signin.ts (posters)
      heading: "Changes and checks",
      bullets: [
        "Only the office (a Manager or Admin) can change a time, and they must give a reason. The old time, new time and reason are kept and shown as \"office changed\".",
        "Sign-ins from a site poster wait for the site supervisor to confirm them (\"to confirm\").",
      ],
    },
    {
      // lib/payroll/store.ts approveDay; lib/payroll/rules.ts dayState, canAccountsApprove, inPayRun;
      // app/api/timesheets/route.ts POST (approve / reopen); lib/attendanceEdits.ts (locked weeks)
      heading: "Approvals, in order",
      bullets: [
        "1. The site supervisor approves the crew's hours for each job and day on their link (\"Approve hours\"). Office, yard and truck sign-ins have no supervisor step.",
        "2. A Manager approves the week from the Monday after, once every sign-in has a sign-out and is confirmed, and every regional travel leg is ended and under 8 hours. That locks it: its sign-ins can't change unless an Admin reopens the week, with a reason.",
        "3. Then you approve or query each person's week in Payroll. Staff can only be approved once the Manager has locked the week. The pay-run file has the employees you approved.",
      ],
    },
    {
      // app/api/accounts/timesheets/export/route.ts; lib/timesheets.ts timesheetCsv
      heading: "Export",
      bullets: [
        "Export downloads the week as a spreadsheet - hours only, one line per sign-in and per travel leg, plus each person's week total.",
        "A locked week exports exactly what the Manager approved. A week not locked yet is marked DRAFT.",
      ],
    },
  ],
};

export async function noticeSeen(userId: string, notice = TIMESHEETS_NOTICE) {
  return !!(await prisma.noticeSeen.findUnique({ where: { userId_notice: { userId, notice } } }));
}

// "Got it": the first press records it; later presses change nothing (the row is never updated).
export async function markNoticeSeen(userId: string, notice = TIMESHEETS_NOTICE) {
  const row = await prisma.noticeSeen.upsert({ where: { userId_notice: { userId, notice } }, create: { userId, notice }, update: {} });
  return { seenAt: row.seenAt.toISOString() };
}

// ---------- the export ----------

// The same spreadsheet the Managers' "Export for accounts" makes (timesheetCsv), with any dollar figure taken out of
// the free text (a name, a site, an office change's reason), then the payroll file check: no $, BSB, TFN, ABA or
// rates. Null when it still fails - the route then refuses rather than send it.
// Only "$"-led amounts go (so "12 Grand Pde" or "5 Tonne Excavator" stay as they are).
export const AMOUNT_REMOVED = "(amount removed)";
const noDollar = (s: string) => s.replace(/[$＄﹩]\s?\d(?:[\d,]*\d)?(?:\.\d+)?/g, AMOUNT_REMOVED);
const noDollarOrNull = (s: string | null) => (s == null ? null : noDollar(s));

export function accountsTimesheetCsv(weekStart: string, lines: TimesheetLine[], approval: { approvedBy: string; approvedAt: Date } | null, travel: TravelLine[] = []): string | null {
  const clean = lines.map((l) => ({ ...l, name: noDollar(l.name), role: noDollarOrNull(l.role), site: noDollar(l.site), changedByOffice: noDollarOrNull(l.changedByOffice) }));
  const cleanTravel = travel.map((t) => ({ ...t, name: noDollar(t.name), role: noDollarOrNull(t.role), site: noDollar(t.site), changedByOffice: noDollarOrNull(t.changedByOffice) }));
  const csv = timesheetCsv(weekStart, clean, approval && { approvedBy: noDollar(approval.approvedBy), approvedAt: approval.approvedAt }, cleanTravel);
  return fileIsSafe(csv) ? csv : null;
}
