// Daily site log, server side (Task K): which jobs a link can log, the crew
// and plant prefill, saving a log (a new revision each time - nothing edited
// or deleted), weekly % complete, and reading it all back for Day Review and
// the job pages. Crew hours come from sign-ins (the same signedHours() Day
// Review and timesheets use); allocations, JobActual, sign-ins and costs are
// never touched. Rules: ./rules.ts and ./checks.ts.
import { prisma } from "../prisma";
import type { ResolvedLink } from "../siteLinks";
import { savePhoto } from "../toolPhotos";
import { signedHours, sydneyTime } from "../signin";
import { effectiveTimes, jobFinish, parseClock } from "../shiftTimes";
import { BY_CODE, VERSION, codeLabel } from "../activityCodes";
import { listBudgets, getBudget } from "../budgets/estimating";
import type { BudgetListItem } from "../budgets/rules";
import { DELAY_LABEL, LIMITS, nextRevision, parseLog, parseProgress, pilotLinkIds, progressKey, type DelayCode, type ParsedLog } from "./rules";
import {
  hoursVsBudget, isMissingLog, logDueAt, pickApprovedBudget, progressDue, splitMismatch, sydneyDay, weekStartOf, type BudgetPackageHours,
} from "./checks";
import type { DayReviewSiteLogDTO, DayReviewSiteLogsDTO, HoursVsBudgetDTO, LinkLogDTO, LogCardDTO, LogDetailDTO, LogJobDTO, ProgressFormDTO } from "./types";

const dateOnly = (day: string) => new Date(`${day}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => { const d = dateOnly(day); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };
const sydneyHour = (at: Date) => +new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", hourCycle: "h23" }).format(at);
const NOT_RUN = ["INACTIVE", "STOOD_DOWN"];
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- the pilot ----------

// The people on the pilot (the person behind each pilot SUPERVISOR link) and their link ids.
export async function pilotPeople(): Promise<Map<string, string[]>> {
  const ids = [...pilotLinkIds()];
  if (!ids.length) return new Map();
  const links = await prisma.siteLink.findMany({ where: { id: { in: ids }, kind: "SUPERVISOR", revokedAt: null, resourceId: { not: null } }, select: { id: true, resourceId: true } });
  const m = new Map<string, string[]>();
  for (const l of links) m.set(l.resourceId!, [...(m.get(l.resourceId!) ?? []), l.id]);
  return m;
}

// A link sees the Daily log when it's a pilot supervisor link, or a stand-in's
// hand-over link for a job a pilot supervisor is on.
export async function isPilotLink(link: ResolvedLink): Promise<boolean> {
  const ids = pilotLinkIds();
  if (!ids.size) return false;
  if (link.kind === "SUPERVISOR") return ids.has(link.id);
  if (link.kind !== "HANDOVER" || !link.jobId) return false;
  const people = await pilotPeople();
  if (!people.size) return false;
  return (await prisma.assignment.count({ where: { jobId: link.jobId, resourceId: { in: [...people.keys()] } } })) > 0;
}

// ---------- which jobs a link logs ----------

// Today's jobs the person is on (not stood down / inactive); until midday,
// yesterday's too - a night shift that finished this morning, or a log
// forgotten last night. A hand-over link: its one job.
const logJobSelect = {
  id: true, date: true, shift: true, title: true, startTime: true, endTime: true, projectId: true,
  project: { select: { id: true, name: true, unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true, jobNo: true, quoteNo: true } },
} as const;

export async function loggableJobs(link: ResolvedLink, now: Date) {
  const today = sydneyDay(now);
  const days = sydneyHour(now) < 12 ? [addDays(today, -1), today] : [today];
  const who = link.kind === "HANDOVER" ? { id: link.jobId ?? "-" } : { assignments: { some: { resourceId: link.person.id ?? "-" } } };
  return prisma.job.findMany({
    where: { ...who, date: { in: days.map(dateOnly) }, status: { notIn: NOT_RUN } },
    select: logJobSelect,
    orderBy: [{ date: "desc" }, { shift: "asc" }],
  });
}
type LogJob = Awaited<ReturnType<typeof loggableJobs>>[number];
const jobLabel = (j: { title: string; shift: string; project: { name: string } | null }) => `${j.project?.name ?? j.title}${j.shift === "NIGHT" ? " (night)" : ""}`;

// ---------- prefill ----------

// Who signed in on a job and their hours: signed-out people as signed,
// anyone still signed in counted up to now. Staff and labour hire both count.
export async function crewFor(jobId: string, now: Date): Promise<LogJobDTO["crew"]> {
  const rows = await prisma.siteAttendance.findMany({
    where: { jobId, status: { not: "REJECTED" } },
    orderBy: { signInAt: "asc" },
    select: { resourceId: true, workerName: true, company: true, signInAt: true, signOutAt: true, job: { select: { project: { select: { unpaidBreakMinutes: true } } } } },
  });
  const people = rows.map((r) => ({
    name: r.workerName, company: r.resourceId ? null : r.company, staff: !!r.resourceId,
    in: sydneyTime(r.signInAt), out: sydneyTime(r.signOutAt), stillOn: !r.signOutAt,
    hours: signedHours(r.signInAt, r.signOutAt ?? (now > r.signInAt ? now : r.signInAt), r.job?.project?.unpaidBreakMinutes) ?? 0,
  }));
  const sum = (xs: typeof people) => r2(xs.reduce((s, p) => s + p.hours, 0));
  const staff = people.filter((p) => p.staff), hire = people.filter((p) => !p.staff);
  return {
    staff: staff.length, staffHours: sum(staff), hire: hire.length, hireHours: sum(hire), count: people.length, hours: sum(people),
    people: people.map(({ staff: _s, ...p }) => p),
  };
}

// The job's machines on the board (owned plant, trucks, hired plant and
// trucks - not labour hire, not attachments, which ride on a machine). The
// default hours are the shift's length from the board's times.
export async function plantFor(job: LogJob): Promise<LogJobDTO["plant"]> {
  const rows = await prisma.assignment.findMany({
    where: { jobId: job.id, resource: { OR: [{ type: { in: ["EQUIPMENT", "VEHICLE"] } }, { type: "HIRE", category: { not: "LABOUR" } }] } },
    select: { resource: { select: { id: true, name: true, type: true, category: true } } },
    orderBy: { resource: { name: "asc" } },
  });
  const t = effectiveTimes(job, job.project);
  const s = parseClock(t.start), e = parseClock(t.end);
  const length = s != null && e != null ? Math.round((((e - s + 1440) % 1440) / 60) * 4) / 4 : null;
  const seen = new Set<string>();
  return rows.filter((a) => !seen.has(a.resource.id) && seen.add(a.resource.id)).map((a) => ({
    resourceId: a.resource.id, name: a.resource.name,
    kind: a.resource.type === "VEHICLE" || (a.resource.type === "HIRE" && a.resource.category === "VEHICLE") ? "TRUCK" : "PLANT",
    defaultHours: length || null,
  }));
}

// Codes offered first: the approved budget's package codes, then codes
// logged on this project before (most used first).
async function suggestedCodes(projectId: string | null, budget: BudgetState): Promise<LogJobDTO["suggested"]> {
  const out: LogJobDTO["suggested"] = [];
  const seen = new Set<string>();
  if (budget.state === "OK") for (const p of budget.packages) if (p.code && BY_CODE[p.code] && !seen.has(p.code)) { seen.add(p.code); out.push({ code: p.code, name: BY_CODE[p.code].name, source: "BUDGET" }); }
  if (projectId) {
    const used = await loggedLabourByCode(projectId, null);
    for (const [code] of [...used.byCode].sort((a, b) => b[1] - a[1])) if (BY_CODE[code] && !seen.has(code)) { seen.add(code); out.push({ code, name: BY_CODE[code].name, source: "BEFORE" }); }
  }
  return out;
}

// ---------- reading logs ----------

const logInclude = {
  hours: { orderBy: { id: "asc" as const } }, delays: { orderBy: { id: "asc" as const } }, dockets: { orderBy: { id: "asc" as const } },
} as const;
type LogRow = NonNullable<Awaited<ReturnType<typeof latestLogRow>>>;
const latestLogRow = (jobId: string) => prisma.dailyLog.findFirst({ where: { jobId }, orderBy: { revision: "desc" }, include: logInclude });
const parseIds = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };

async function toDetail(l: LogRow): Promise<LogDetailDTO> {
  const resIds = l.hours.map((h) => h.resourceId).filter((x): x is string => !!x);
  const names = new Map((resIds.length ? await prisma.resource.findMany({ where: { id: { in: resIds } }, select: { id: true, name: true } }) : []).map((r) => [r.id, r.name]));
  return {
    id: l.id, revision: l.revision, submittedBy: l.submittedBy, at: l.createdAt.toISOString(), atLabel: sydneyTime(l.createdAt) ?? "",
    codesVersion: l.codesVersion, crewCount: l.crewCount, labourHours: l.labourHours, splitHours: l.splitHours, crewOk: l.crewOk, crewNote: l.crewNote,
    note: l.note, photos: parseIds(l.photoIds), noDelays: l.noDelays, noDockets: l.noDockets, durationSec: l.durationSec,
    hours: l.hours.map((h) => ({ code: h.code, label: codeLabel(h.code), kind: h.kind, resourceId: h.resourceId, resourceName: h.resourceId ? names.get(h.resourceId) ?? null : null, hours: h.hours })),
    delays: l.delays.map((d) => ({ delayCode: d.delayCode, label: DELAY_LABEL[d.delayCode as DelayCode] ?? d.delayCode, hoursLost: d.hoursLost, affects: d.affects, note: d.note, photos: parseIds(d.photoIds) })),
    dockets: l.dockets.map((d) => ({ code: d.code, wasteClass: d.wasteClass, quantity: d.quantity, unit: d.unit, docketNo: d.docketNo, facility: d.facility, photo: d.photoId })),
  };
}

// Labour hours by code on a project - the latest version of each job's log
// only (a correction replaces, never adds), optionally up to a date.
export async function loggedLabourByCode(projectId: string, upTo: string | null) {
  const logs = await prisma.dailyLog.findMany({
    where: { projectId, ...(upTo ? { date: { lte: upTo } } : {}) },
    orderBy: [{ jobId: "asc" }, { revision: "desc" }],
    select: { jobId: true, revision: true, hours: { where: { kind: "LABOUR" }, select: { code: true, hours: true } } },
  });
  const latest = new Map<string, (typeof logs)[number]>();
  for (const l of logs) if (!latest.has(l.jobId)) latest.set(l.jobId, l);
  const byCode = new Map<string, number>();
  for (const l of latest.values()) for (const h of l.hours) byCode.set(h.code, r2((byCode.get(h.code) ?? 0) + h.hours));
  return { byCode, logs: latest.size };
}

// ---------- the approved budget (piece 6) ----------

export type BudgetState =
  | { state: "OK"; ref: string; name: string; packages: BudgetPackageHours[] }
  | { state: "NONE" } | { state: "DOWN" };

// The budget list changes rarely - kept for a minute so a page or a link
// opening doesn't ask Estimating every time.
let listCache: { at: number; rows: BudgetListItem[] | null } | null = null;
async function budgetList(): Promise<BudgetListItem[] | null> {
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.rows;
  const r = await listBudgets();
  listCache = { at: Date.now(), rows: r.ok ? r.data : null };
  return listCache.rows;
}

export async function approvedBudgetFor(project: { jobNo: string | null; quoteNo: string | null }): Promise<BudgetState> {
  const rows = await budgetList();
  if (!rows) return { state: "DOWN" };
  const pick = pickApprovedBudget(rows, project);
  if (!pick) return { state: "NONE" };
  const d = await getBudget(pick.estimate_id, pick.revision);
  if (!d.ok) return d.status === 404 ? { state: "NONE" } : { state: "DOWN" };
  return {
    state: "OK", ref: `${pick.estimate_id}/r${pick.revision}`, name: d.data.budget.estimate_name,
    packages: d.data.budget.packages.map((p) => ({ packageId: p.package_id, code: p.code, name: p.name, labourHrs: p.hours?.labour_hrs ?? 0 })),
  };
}

// Labour hours vs the approved budget for a project, as at a date (default: all logs).
export async function hoursVsBudgetFor(project: { id: string; jobNo: string | null; quoteNo: string | null }, upTo: string | null = null, budget?: BudgetState): Promise<HoursVsBudgetDTO> {
  const logged = await loggedLabourByCode(project.id, upTo);
  if (!logged.logs) return { state: "NO_LOGS" };
  const b = budget ?? (await approvedBudgetFor(project));
  if (b.state === "DOWN") return { state: "ESTIMATING_DOWN" };
  if (b.state === "NONE") return { state: "NO_BUDGET" };
  const pct = await latestPct(project.id, upTo ? weekStartOf(upTo) : null);
  return { state: "OK", budgetRef: b.ref, budgetName: b.name, logs: logged.logs, rows: hoursVsBudget(b.packages, logged.byCode, logged.logs, pct) };
}

// Each line's latest weekly % (any revision, any week up to the one given).
async function latestPct(projectId: string, upToWeek: string | null) {
  const weeks = await prisma.weeklyProgress.findMany({
    where: { projectId, ...(upToWeek ? { weekStart: { lte: upToWeek } } : {}) },
    orderBy: [{ weekStart: "desc" }, { revision: "desc" }],
    select: { lines: { select: { packageId: true, code: true, pctComplete: true } } },
  });
  const m = new Map<string, number>();
  for (const w of weeks) for (const l of w.lines) { const k = progressKey(l); if (!m.has(k)) m.set(k, l.pctComplete); }
  return m;
}

// ---------- the link: GET ----------

async function closedDays(days: string[]) {
  const rows = await prisma.dayClose.findMany({ where: { date: { in: days }, status: "CLOSED" }, select: { date: true } });
  return new Set(rows.map((r) => r.date));
}

export async function linkLogView(link: ResolvedLink, now: Date): Promise<LinkLogDTO> {
  const jobs = await loggableJobs(link, now);
  const closed = await closedDays([...new Set(jobs.map((j) => isoDay(j.date)))]);
  const budgets = new Map<string, BudgetState>();
  for (const j of jobs) if (j.project && !budgets.has(j.project.id)) budgets.set(j.project.id, await approvedBudgetFor(j.project));
  const out: LogJobDTO[] = [];
  for (const j of jobs) {
    const [crew, plant, latest] = await Promise.all([crewFor(j.id, now), plantFor(j), latestLogRow(j.id)]);
    out.push({
      jobId: j.id, date: isoDay(j.date), shift: j.shift, label: jobLabel(j), closed: closed.has(isoDay(j.date)),
      crew, plant, suggested: await suggestedCodes(j.projectId, j.project ? budgets.get(j.project.id)! : { state: "NONE" }),
      latest: latest ? await toDetail(latest) : null,
    });
  }
  const progress = await progressForms(link, now, budgets);
  return { jobs: out, progress };
}

// Weekly % forms for the projects the person worked on this week.
async function progressProjects(link: ResolvedLink, now: Date) {
  const today = sydneyDay(now), monday = weekStartOf(today);
  const who = link.kind === "HANDOVER" ? { id: link.jobId ?? "-" } : { assignments: { some: { resourceId: link.person.id ?? "-" } } };
  const jobs = await prisma.job.findMany({
    where: { ...who, projectId: { not: null }, status: { notIn: NOT_RUN }, date: { gte: dateOnly(addDays(monday, -7)), lte: dateOnly(today) } },
    select: { date: true, project: { select: { id: true, name: true, jobNo: true, quoteNo: true } } },
  });
  const m = new Map<string, { id: string; name: string; jobNo: string | null; quoteNo: string | null; thisWeek: boolean; lastWeek: boolean }>();
  for (const j of jobs) {
    const p = j.project!, mine = m.get(p.id) ?? { ...p, thisWeek: false, lastWeek: false };
    if (isoDay(j.date) >= monday) mine.thisWeek = true; else mine.lastWeek = true;
    m.set(p.id, mine);
  }
  return [...m.values()].filter((p) => p.thisWeek); // on it this week
}

async function allowedLines(projectId: string, budget: BudgetState) {
  const allowed = new Map<string, { packageId: string | null; code: string; label: string }>();
  if (budget.state === "OK") {
    for (const p of budget.packages) allowed.set(progressKey({ packageId: p.packageId, code: p.code ?? "" }), { packageId: p.packageId, code: p.code ?? "", label: p.code ? `${p.name} (${p.code})` : p.name });
    return { basis: "BUDGET" as const, allowed };
  }
  const used = await loggedLabourByCode(projectId, null);
  for (const code of [...used.byCode.keys()].sort()) allowed.set(progressKey({ packageId: null, code }), { packageId: null, code, label: codeLabel(code) });
  return { basis: "CODES" as const, allowed };
}

async function progressForms(link: ResolvedLink, now: Date, budgets: Map<string, BudgetState>): Promise<ProgressFormDTO[]> {
  const today = sydneyDay(now), monday = weekStartOf(today);
  const out: ProgressFormDTO[] = [];
  for (const p of await progressProjects(link, now)) {
    const budget = budgets.get(p.id) ?? (await approvedBudgetFor(p));
    const { basis, allowed } = await allowedLines(p.id, budget);
    if (!allowed.size) continue; // nothing logged and no budget yet - nothing to report against
    const [thisWeek, last, lastWeekRow] = await Promise.all([
      prisma.weeklyProgress.findFirst({ where: { projectId: p.id, weekStart: monday }, orderBy: { revision: "desc" }, include: { lines: true } }),
      latestPct(p.id, addDays(monday, -7)),
      prisma.weeklyProgress.count({ where: { projectId: p.id, weekStart: addDays(monday, -7) } }),
    ]);
    const now7 = new Map((thisWeek?.lines ?? []).map((l) => [progressKey(l), l.pctComplete]));
    out.push({
      projectId: p.id, projectName: p.name, basis, weekStart: monday, savedAt: thisWeek?.createdAt.toISOString() ?? null,
      budgetUnavailable: budget.state === "DOWN",
      due: progressDue(today, { thisWeek: !!thisWeek, lastWeek: lastWeekRow > 0, workedLastWeek: p.lastWeek }),
      lines: [...allowed.entries()].map(([k, l]) => ({ ...l, last: last.get(k) ?? null, thisWeek: now7.get(k) ?? null })),
    });
  }
  return out;
}

// The home card's summary (only for pilot links).
export async function logCard(link: ResolvedLink, now: Date): Promise<LogCardDTO> {
  const jobs = await loggableJobs(link, now);
  const today = jobs.filter((j) => isoDay(j.date) === sydneyDay(now));
  const logs = await prisma.dailyLog.findMany({ where: { jobId: { in: today.map((j) => j.id) } }, orderBy: { createdAt: "desc" }, select: { jobId: true, createdAt: true } });
  const forms = await progressForms(link, now, new Map());
  return { jobs: today.length, logged: new Set(logs.map((l) => l.jobId)).size, lastAt: logs[0]?.createdAt.toISOString() ?? null, progressDue: forms.some((f) => f.due) };
}

// ---------- the link: POST a log ----------

type Saved = { error: string; status: number } | { log: LogDetailDTO };

export async function submitLog(link: ResolvedLink, body: Record<string, unknown>, now: Date): Promise<Saved> {
  const sent = await prisma.dailyLog.count({ where: { siteLinkId: link.id, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } });
  if (sent >= LIMITS.logsPerLinkPerDay) return { error: "That's the most logs this link can send in a day - call the office.", status: 429 };
  const job = (await loggableJobs(link, now)).find((j) => j.id === body.jobId);
  if (!job) return { error: "That job isn't one you can log today.", status: 403 };
  const day = isoDay(job.date);
  if ((await closedDays([day])).size) return { error: "The office has closed that day - tell them what to change.", status: 409 };

  const [crew, plant, prior] = await Promise.all([
    crewFor(job.id, now), plantFor(job),
    prisma.dailyLog.findMany({ where: { jobId: job.id }, select: { revision: true, photoIds: true, delays: { select: { photoIds: true } }, dockets: { select: { photoId: true } } } }),
  ]);
  const parsed = parseLog(body, { signedHours: crew.hours, signedCrew: crew.count, plant: new Map(plant.map((p) => [p.resourceId, p.kind])) });
  if ("error" in parsed) return { error: parsed.error, status: 400 };

  // Photos: new ones (data URLs) are saved; one kept from an earlier version must really be that job's.
  const earlier = new Set(prior.flatMap((l) => [...parseIds(l.photoIds), ...l.delays.flatMap((d) => parseIds(d.photoIds)), ...l.dockets.map((d) => d.photoId ?? "")]).filter(Boolean));
  const store = async (p: string): Promise<string | { error: string }> => {
    if (!p.startsWith("data:")) return earlier.has(p) ? p : { error: "A photo in the log couldn't be found - add it again." };
    const s = await savePhoto(p);
    return "error" in s ? s : s.fileName;
  };
  const storeAll = async (ps: string[]) => { const out: string[] = []; for (const p of ps) { const s = await store(p); if (typeof s !== "string") return s; out.push(s); } return out; };
  const photos = await storeAll(parsed.photos);
  if (!Array.isArray(photos)) return { error: photos.error, status: 400 };
  const delays: (Omit<ParsedLog["delays"][number], "photos"> & { photoIds: string })[] = [];
  for (const d of parsed.delays) { const ps = await storeAll(d.photos); if (!Array.isArray(ps)) return { error: ps.error, status: 400 }; const { photos: _p, ...rest } = d; delays.push({ ...rest, photoIds: JSON.stringify(ps) }); }
  const dockets: (Omit<ParsedLog["dockets"][number], "photo"> & { photoId: string | null })[] = [];
  for (const d of parsed.dockets) { const s = d.photo ? await store(d.photo) : null; if (s && typeof s !== "string") return { error: s.error, status: 400 }; const { photo: _p, ...rest } = d; dockets.push({ ...rest, photoId: s }); }

  const data = (revision: number) => ({
    jobId: job.id, projectId: job.projectId, date: day, revision, siteLinkId: link.id, submittedBy: link.person.name, codesVersion: VERSION,
    crewCount: parsed.crewCount, labourHours: parsed.labourHours, splitHours: parsed.splitHours, crewOk: parsed.crewOk, crewNote: parsed.crewNote,
    note: parsed.note, photoIds: JSON.stringify(photos), noDelays: parsed.noDelays, noDockets: parsed.noDockets, durationSec: parsed.durationSec,
    hours: { create: parsed.hours }, delays: { create: delays }, dockets: { create: dockets },
  });
  // Two phones submitting at once: the unique (job, revision) catches it - try the next number once.
  let revision = nextRevision(prior.map((l) => l.revision));
  const saved = await prisma.dailyLog.create({ data: data(revision), include: logInclude }).catch(async () => {
    revision = nextRevision((await prisma.dailyLog.findMany({ where: { jobId: job.id }, select: { revision: true } })).map((l) => l.revision));
    return prisma.dailyLog.create({ data: data(revision), include: logInclude });
  });
  return { log: await toDetail(saved) };
}

// ---------- the link: POST weekly % ----------

export async function submitProgress(link: ResolvedLink, body: Record<string, unknown>, now: Date): Promise<{ error: string; status: number } | { form: ProgressFormDTO }> {
  const project = (await progressProjects(link, now)).find((p) => p.id === body.projectId);
  if (!project) return { error: "That job isn't one you're on this week.", status: 403 };
  const budget = await approvedBudgetFor(project);
  const sentPackages = Array.isArray(body.lines) && body.lines.some((l) => l && typeof l === "object" && (l as { packageId?: unknown }).packageId);
  if (budget.state === "DOWN" && sentPackages) return { error: "Can't check the job's packages right now - try again in a few minutes.", status: 503 };
  const { basis, allowed } = await allowedLines(project.id, budget);
  const monday = weekStartOf(sydneyDay(now));
  const last = await latestPct(project.id, monday);
  const lines = parseProgress(body, allowed, last);
  if ("error" in lines) return { error: lines.error, status: 400 };
  const prior = await prisma.weeklyProgress.findMany({ where: { projectId: project.id, weekStart: monday }, select: { revision: true } });
  await prisma.weeklyProgress.create({
    data: {
      projectId: project.id, weekStart: monday, revision: nextRevision(prior.map((p) => p.revision)), siteLinkId: link.id, submittedBy: link.person.name,
      basis, budgetRef: budget.state === "OK" && basis === "BUDGET" ? budget.ref : null, lines: { create: lines },
    },
  });
  const form = (await progressForms(link, now, new Map([[project.id, budget]]))).find((f) => f.projectId === project.id)!;
  return { form };
}

// ---------- Day Review ----------

export async function siteLogsForDate(date: string, now: Date, withBudgets: boolean): Promise<DayReviewSiteLogsDTO> {
  const people = await pilotPeople();
  const jobs = await prisma.job.findMany({
    where: { date: dateOnly(date) },
    select: {
      ...logJobSelect, status: true,
      assignments: { select: { resourceId: true, resource: { select: { type: true } } } },
      _count: { select: { attendances: { where: { status: { not: "REJECTED" } } } } },
    },
  });
  const ids = jobs.map((j) => j.id);
  const logs = ids.length ? await prisma.dailyLog.findMany({ where: { jobId: { in: ids } }, orderBy: { revision: "desc" }, include: logInclude }) : [];
  const monday = weekStartOf(date);
  const out: DayReviewSiteLogDTO[] = [];
  for (const j of jobs) {
    const mine = logs.filter((l) => l.jobId === j.id);
    const pilot = j.assignments.some((a) => people.has(a.resourceId));
    if (!pilot && !mine.length) continue;
    const ran = !NOT_RUN.includes(j.status) && (j._count.attendances > 0 || j.assignments.some((a) => a.resource.type === "PERSONNEL"));
    const t = effectiveTimes(j, j.project);
    const dueAt = logDueAt({ date, shift: j.shift, finish: jobFinish(date, j.shift, t.start, t.end) });
    const crew = await crewFor(j.id, now);
    const latest = mine[0] ?? null;
    let progress: DayReviewSiteLogDTO["progress"] = null;
    if (j.projectId) {
      const w = await prisma.weeklyProgress.findFirst({ where: { projectId: j.projectId, weekStart: monday }, orderBy: { revision: "desc" }, include: { lines: true } });
      if (w) {
        const before = await latestPct(j.projectId, addDays(monday, -7));
        progress = { weekStart: monday, submittedBy: w.submittedBy, at: w.createdAt.toISOString(), lines: w.lines.map((l) => ({ label: l.label, code: l.code, pct: l.pctComplete, last: before.get(progressKey(l)) ?? null, reason: l.reason })) };
      }
    }
    out.push({
      jobId: j.id, projectId: j.projectId, pilot, ran, dueAt: dueAt.toISOString(),
      missing: isMissingLog({ pilot, ran, hasLog: !!latest, dueAt }, now),
      latest: latest ? { ...(await toDetail(latest)), logId: latest.id } : null,
      earlier: mine.slice(1).map((l) => ({ revision: l.revision, submittedBy: l.submittedBy, at: l.createdAt.toISOString(), labourHours: l.labourHours, splitHours: l.splitHours })),
      signedNow: crew.hours, mismatch: latest ? splitMismatch(latest, crew.hours) : false, byHand: latest ? !latest.crewOk : false, progress,
    });
  }
  const budgets: Record<string, HoursVsBudgetDTO> = {};
  if (withBudgets) {
    for (const j of jobs) if (j.project && !budgets[j.project.id] && out.some((o) => o.jobId === j.id)) budgets[j.project.id] = await hoursVsBudgetFor(j.project, date);
  }
  return { date, pilotOn: people.size > 0, missingCount: out.filter((o) => o.missing).length, codesVersion: VERSION, jobs: out, budgets };
}

// A log's photo, for Day Review: only a file that log (or one of its delays or dockets) holds.
export async function logPhotoFile(logId: string, file: string): Promise<string | null> {
  const l = await prisma.dailyLog.findUnique({ where: { id: logId }, select: { photoIds: true, delays: { select: { photoIds: true } }, dockets: { select: { photoId: true } } } });
  if (!l) return null;
  const all = [...parseIds(l.photoIds), ...l.delays.flatMap((d) => parseIds(d.photoIds)), ...l.dockets.map((d) => d.photoId)];
  return all.includes(file) ? file : null;
}
