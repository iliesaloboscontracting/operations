// Accounts stage 2 - payroll, server side (docs/accounts/STAGE2-DESIGN.md): the week's hours for everyone
// who signed in (staff, ABN workers, labour hire), the supervisors' daily approvals, the Manager's existing
// weekly lock, and Victoria's final approve / query - plus the pay-run and summary files. Reads sign-ins
// only; writes HoursApproval and PayWeekReview rows. Hours only, never money.
import { prisma } from "../prisma";
import { jobLabel, POINT_BREAK_MINUTES, signedHours, sydneyTime } from "../signin";
import { matchHireSignIns } from "../labourHireMatch";
import { activeApproval, weekDates, weekEnd, weekHasEnded } from "../timesheets";
import { assertNoMoney } from "../moneyGuard";
import { todaySydney } from "../today";
import type { ResolvedLink } from "../siteLinks";
import {
  canAccountsApprove, dayState, fileIsSafe, groupOf, inPayRun, payRunRows, personKeyOf, summarise, toCsv, TRAVEL_HOOK,
  type ApprovalSnapshotLine, type DayState, type Group, type PayLine,
} from "./rules";

type Problem = { error: string; status: number };
const parse = <T,>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

// ---------- the week's lines ----------

export async function payLines(weekStart: string): Promise<PayLine[]> {
  const rows = await prisma.siteAttendance.findMany({
    where: { date: { gte: weekStart, lte: weekEnd(weekStart) }, status: { not: "REJECTED" } },
    orderBy: [{ workerName: "asc" }, { signInAt: "asc" }],
    select: {
      id: true, date: true, jobId: true, resourceId: true, workerName: true, company: true, signInAt: true, signOutAt: true, status: true,
      placeLabel: true, place: true, gpsLat: true, gpsLng: true, gpsAccuracyM: true, gpsStatus: true,
      resource: { select: { id: true, name: true, type: true, engagement: true } },
      job: { select: { title: true, shift: true, project: { select: { name: true, unpaidBreakMinutes: true } } } },
    },
  });
  // Labour hire sign-ins fill the board's labour-hire tiles (lib/labourHireMatch.ts).
  const jobIds = [...new Set(rows.filter((r) => r.jobId && !r.resourceId).map((r) => r.jobId!))];
  const tiles = jobIds.length ? await prisma.assignment.findMany({ where: { jobId: { in: jobIds }, resource: { type: "HIRE", category: "LABOUR" } }, select: { jobId: true, resource: { select: { id: true, name: true } } } }) : [];
  const tileOf = new Map<string, string>();
  for (const jobId of jobIds) {
    matchHireSignIns(tiles.filter((t) => t.jobId === jobId).map((t) => t.resource), rows.filter((r) => r.jobId === jobId && !r.resourceId)).forEach((t, id) => tileOf.set(id, t.name));
  }
  return rows.filter((r) => !r.resource || r.resource.type === "PERSONNEL").map((r) => {
    const breakMinutes = r.job ? r.job.project?.unpaidBreakMinutes ?? 0 : POINT_BREAK_MINUTES;
    const name = r.resource?.name ?? r.workerName;
    return {
      attendanceId: r.id, date: r.date, personKey: personKeyOf(r.resourceId, name, r.company), personName: name,
      resourceId: r.resourceId, company: r.company, group: groupOf(r.resourceId, r.resource?.engagement ?? null), engagementSet: !r.resourceId || !!r.resource?.engagement,
      jobId: r.jobId, shift: (r.job?.shift === "NIGHT" ? "NIGHT" : "DAY") as "DAY" | "NIGHT", site: r.job ? jobLabel(r.job) : r.placeLabel ?? r.place ?? "Sign-in point", point: !r.jobId,
      in: sydneyTime(r.signInAt)!, out: sydneyTime(r.signOutAt), hours: signedHours(r.signInAt, r.signOutAt, breakMinutes), status: r.status, tile: tileOf.get(r.id) ?? null,
      gps: r.gpsLat != null && r.gpsLng != null ? { lat: r.gpsLat, lng: r.gpsLng, accuracyM: r.gpsAccuracyM } : null, gpsStatus: r.gpsStatus,
    };
  });
}

// The latest supervisor approval for each job and day.
async function latestApprovals(pairs: { jobId: string; date: string }[]) {
  const jobIds = [...new Set(pairs.map((p) => p.jobId))];
  if (!jobIds.length) return new Map<string, { snapshot: ApprovalSnapshotLine[]; by: string; at: Date; note: string | null }>();
  const rows = await prisma.hoursApproval.findMany({ where: { jobId: { in: jobIds } }, orderBy: { approvedAt: "desc" } });
  const out = new Map<string, { snapshot: ApprovalSnapshotLine[]; by: string; at: Date; note: string | null }>();
  for (const r of rows) { const k = `${r.jobId}|${r.date}`; if (!out.has(k)) out.set(k, { snapshot: parse(r.snapshot, []), by: r.approvedBy, at: r.approvedAt, note: r.note }); }
  return out;
}

async function latestReviews(weekStart: string) {
  const rows = await prisma.payWeekReview.findMany({ where: { weekStart }, orderBy: { at: "desc" } });
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!out.has(r.personKey)) out.set(r.personKey, r);
  return out;
}

// ---------- Accounts -> Payroll (guardAccounts) ----------

export type PayDayLine = PayLine & { dayState: DayState; flag: string | null; approvedBy: string | null };
export type PayPersonDTO = {
  personKey: string; name: string; group: Group; company: string | null; engagementSet: boolean; hours: number;
  days: Record<string, PayDayLine[]>; issues: string[]; review: { status: string; note: string | null; by: string; at: string } | null;
  canApprove: string | null; // null = Victoria can approve now; else why not
  inPayRun: boolean;
};

export async function payrollWeek(weekStart: string) {
  const [lines, lock, reviews] = await Promise.all([payLines(weekStart), activeApproval(weekStart), latestReviews(weekStart)]);
  const approvals = await latestApprovals(lines.filter((l) => l.jobId).map((l) => ({ jobId: l.jobId!, date: l.date })));
  const ended = weekHasEnded(weekStart);
  const people = new Map<string, PayPersonDTO>();
  for (const l of lines) {
    const a = l.jobId ? approvals.get(`${l.jobId}|${l.date}`) ?? null : null;
    const snap = a?.snapshot.find((x) => x.attendanceId === l.attendanceId);
    const line: PayDayLine = { ...l, dayState: dayState(l, a?.snapshot ?? null), flag: snap?.flag ?? null, approvedBy: a && snap ? a.by : null };
    const r = reviews.get(l.personKey);
    const p = people.get(l.personKey) ?? {
      personKey: l.personKey, name: l.personName, group: l.group, company: l.company, engagementSet: l.engagementSet, hours: 0,
      days: Object.fromEntries(weekDates(weekStart).map((d) => [d, [] as PayDayLine[]])), issues: [],
      review: r ? { status: r.status, note: r.note, by: r.by, at: r.at.toISOString() } : null,
      canApprove: canAccountsApprove(l.group, !!lock, ended), inPayRun: inPayRun(l.group, r?.status ?? null),
    };
    (p.days[l.date] ??= []).push(line);
    p.hours += l.hours ?? 0;
    people.set(l.personKey, p);
  }
  for (const p of people.values()) {
    const all = Object.values(p.days).flat();
    const count = (s: DayState) => all.filter((x) => x.dayState === s).length;
    p.issues = [
      ...(all.some((x) => !x.out) ? ["No sign-out on a day"] : []),
      ...(count("NOT_APPROVED") ? [`${count("NOT_APPROVED")} day(s) not approved by the supervisor`] : []),
      ...(count("FLAGGED") ? [`${count("FLAGGED")} day(s) flagged by the supervisor`] : []),
      ...(count("CHANGED") ? [`${count("CHANGED")} day(s) changed since the supervisor approved`] : []),
      ...(p.group === "HIRE" && all.some((x) => x.jobId && !x.tile) ? ["Signed in where no labour hire was booked on the board"] : []),
    ];
    p.hours = Math.round(p.hours * 4) / 4;
  }
  const list = [...people.values()].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  // People whose notes mention ABN but engagement isn't set - for the office to check (never set automatically).
  const abnHints = await prisma.resource.findMany({
    where: { type: "PERSONNEL", active: true, engagement: null, OR: [{ notes: { contains: "ABN" } }, { payRateNotes: { contains: "ABN" } }] },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  return {
    weekStart, weekEnd: weekEnd(weekStart), days: weekDates(weekStart), weekEnded: ended,
    managerLock: lock ? { by: lock.approvedBy, at: lock.approvedAt.toISOString() } : null,
    people: list, engagementUnset: list.filter((p) => p.group === "EMPLOYEE" && !p.engagementSet).length, summary: summarise(lines, new Map([...reviews].map(([k, r]) => [k, r.status]))), abnHints, travel: TRAVEL_HOOK,
  };
}

export async function reviewPerson(who: { id: string; name: string }, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const weekStart = String(b.week ?? ""), personKey = String(b.personKey ?? ""), status = String(b.status ?? "").toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { error: "Pick the week.", status: 400 };
  if (status !== "APPROVED" && status !== "QUERY") return { error: "Approve or query.", status: 400 };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
  if (status === "QUERY" && note.length < 3) return { error: "Say what needs checking.", status: 400 };
  const week = await payrollWeek(weekStart);
  const p = week.people.find((x) => x.personKey === personKey);
  if (!p) return { error: "That person has no hours this week.", status: 404 };
  if (status === "APPROVED" && p.canApprove) return { error: p.canApprove, status: 409 };
  await prisma.payWeekReview.create({
    data: {
      weekStart: week.weekStart, personKey, personName: p.name, status, hours: p.hours, note: note || null, by: who.name, byId: who.id,
      snapshot: JSON.stringify(Object.values(p.days).flat().map((l) => ({ attendanceId: l.attendanceId, date: l.date, site: l.site, in: l.in, out: l.out, hours: l.hours, dayState: l.dayState }))),
    },
  });
  return { ok: true };
}

// The pay-run file (employees Victoria approved) and the weekly summary. Hours only.
export async function payrollFiles(weekStart: string): Promise<{ payRun: string; summary: string }> {
  const week = await payrollWeek(weekStart);
  const lines = Object.values(week.people).flatMap((p) => Object.values(p.days).flat());
  const approved = new Set(week.people.filter((p) => p.inPayRun).map((p) => p.personKey));
  const emails = new Map((await prisma.resource.findMany({ where: { id: { in: [...approved] } }, select: { id: true, email: true } })).map((r) => [r.id, r.email]));
  const payRun = toCsv(payRunRows(lines, approved, emails));
  const s = week.summary;
  const summary = toCsv([
    [`Lobos Contracting - weekly hours summary, ${week.weekStart} to ${week.weekEnd}`],
    [week.managerLock ? `Timesheet locked by ${week.managerLock.by}` : "Timesheet not locked by a Manager yet"],
    [],
    ["Person", "Group", "Company", "Days", "Hours", "Ordinary", "Night", "Saturday", "Sunday", "Accounts", "Travel"],
    ...s.people.map((p) => [p.name, p.group === "HIRE" ? "Labour hire" : p.group === "ABN" ? "ABN" : "Employee", p.company, p.days, p.hours,
      p.byItem["Ordinary Hours"] ?? 0, p.byItem["Night Hours"] ?? 0, p.byItem["Saturday Hours"] ?? 0, p.byItem["Sunday Hours"] ?? 0, p.review ?? "Not reviewed", TRAVEL_HOOK]),
    [],
    ["Total hours", s.total],
    ...Object.entries(s.bySite).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`Site: ${k}`, v]),
    ...Object.entries(s.byAgency).map(([k, v]) => [`Labour hire: ${k}`, v]),
  ]);
  if (!fileIsSafe(payRun) || !fileIsSafe(summary)) throw new Error("A payroll file looked like it had money in it - not sent.");
  return { payRun, summary };
}

// ---------- the supervisor's daily approval (site link) ----------

export type CrewHoursDTO = { attendanceId: string; name: string; company: string | null; in: string; out: string | null; hours: number | null; toConfirm: boolean };
export type DayHoursDTO = { date: string; jobs: { jobId: string; label: string; crew: CrewHoursDTO[]; approved: { by: string; at: string; changed: boolean } | null; flags: Record<string, string> }[] };

// The supervisor's jobs on a day (on the board for them), with everyone who signed in. Names and hours only.
export async function dayHoursForLink(link: ResolvedLink, date: string): Promise<DayHoursDTO> {
  if (!link.person.id) return { date, jobs: [] };
  const jobs = await prisma.job.findMany({
    where: { date: new Date(`${date}T00:00:00.000Z`), assignments: { some: { resourceId: link.person.id } } },
    select: { id: true, title: true, shift: true, project: { select: { name: true, unpaidBreakMinutes: true } } },
  });
  const atts = jobs.length ? await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, status: { not: "REJECTED" } }, orderBy: { signInAt: "asc" },
    select: { id: true, jobId: true, workerName: true, company: true, signInAt: true, signOutAt: true, status: true, resource: { select: { name: true } } },
  }) : [];
  const approvals = await latestApprovals(jobs.map((j) => ({ jobId: j.id, date })));
  const dto: DayHoursDTO = {
    date,
    jobs: jobs.filter((j) => atts.some((a) => a.jobId === j.id)).map((j) => {
      const crew = atts.filter((a) => a.jobId === j.id).map((a) => ({
        attendanceId: a.id, name: a.resource?.name ?? a.workerName, company: a.company, in: sydneyTime(a.signInAt)!, out: sydneyTime(a.signOutAt),
        hours: signedHours(a.signInAt, a.signOutAt, j.project?.unpaidBreakMinutes ?? 0), toConfirm: a.status === "TO_CONFIRM",
      }));
      const a = approvals.get(`${j.id}|${date}`);
      const changed = !!a && crew.some((c) => dayState({ ...c, jobId: j.id }, a.snapshot) !== "APPROVED" && dayState({ ...c, jobId: j.id }, a.snapshot) !== "FLAGGED");
      return { jobId: j.id, label: jobLabel(j), crew, approved: a ? { by: a.by, at: a.at.toISOString(), changed } : null, flags: Object.fromEntries((a?.snapshot ?? []).filter((x) => x.flag).map((x) => [x.attendanceId, x.flag!])) };
    }),
  };
  if (!assertNoMoney(JSON.stringify(dto))) throw new Error("money in the supervisor's hours");
  return dto;
}

export async function approveDay(link: ResolvedLink, b: Record<string, unknown>): Promise<{ ok: true; message: string } | Problem> {
  if (link.kind !== "SUPERVISOR" || !link.person.id) return { error: "Hours are approved from a supervisor's own link.", status: 403 };
  const date = String(b.date ?? ""), jobId = String(b.jobId ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the day.", status: 400 };
  const day = await dayHoursForLink(link, date);
  const job = day.jobs.find((j) => j.jobId === jobId);
  if (!job) return { error: "That isn't one of your jobs that day.", status: 404 };
  // Today the supervisor can still sign people out / confirm posters on "Sign in crew", so today waits for that.
  // A past day can't be fixed from the link (only the office changes a past time - 27 Oct 2026: supervisors were
  // stuck approving yesterday), so a missing sign-out or an unconfirmed poster never blocks it: it's flagged for
  // the office automatically, next to anything the supervisor flags.
  const past = date < todaySydney();
  if (!past && job.crew.some((c) => !c.out)) return { error: "Someone hasn't signed out yet - sign them out first.", status: 409 };
  if (!past && job.crew.some((c) => c.toConfirm)) return { error: "Confirm the poster sign-ins first.", status: 409 };
  const flagsIn = b.flags && typeof b.flags === "object" ? (b.flags as Record<string, unknown>) : {};
  const snapshot: ApprovalSnapshotLine[] = job.crew.map((c) => {
    const own = typeof flagsIn[c.attendanceId] === "string" ? (flagsIn[c.attendanceId] as string).trim().slice(0, 200) : "";
    const auto = [!c.out && "No sign-out - office to set the time", c.toConfirm && "Poster sign-in not confirmed"].filter(Boolean).join("; ");
    const f = [own, auto].filter(Boolean).join(" · ").slice(0, 300);
    return { attendanceId: c.attendanceId, name: c.name, company: c.company, in: c.in, out: c.out, hours: c.hours, ...(f ? { flag: f } : {}) };
  });
  if (!assertNoMoney(JSON.stringify(snapshot))) return { error: "No dollar figures in a note, please.", status: 400 };
  await prisma.hoursApproval.create({
    data: { jobId, date, siteLinkId: link.id, approvedBy: link.person.name, approvedByResourceId: link.person.id, snapshot: JSON.stringify(snapshot), note: typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null },
  });
  const flagged = snapshot.filter((s) => s.flag).length;
  return { ok: true, message: `Hours approved for ${job.label}${flagged ? ` - ${flagged} flagged for the office` : ""}.` };
}

// For /timesheets: Victoria's latest decision per person this week (status and note only).
export async function accountsStatusForWeek(weekStart: string) {
  return Object.fromEntries([...(await latestReviews(weekStart))].map(([k, r]) => [k, { status: r.status, note: r.note, by: r.by }]));
}
