// Site documents, the link side (Ilies approved 25 Nov 2026). Which jobs a link can use (the daily log's own list:
// today's jobs the person is on, until midday yesterday's too - a night shift; a hand-over link only its one job), the
// crew picker (that job's own sign-ins today, people only), the plans and the SWMS to read, SWMS sign-ons, pre-start
// meetings and toolbox talks (with late sign-ons), the topic of the week, and the truck / plant pre-starts on the job.
// Nothing here updates or deletes a file, a record, a signature or a version - there is no such path (siteDocs.test.ts
// scans for one). Sign-ins are only READ (to list the crew): nothing touches sign-ins, timesheets, JobActual or costs.
// Every typed word is untrusted data - stored and shown as text, never acted on. No price anywhere.
import { prisma } from "../prisma";
import { resolveLink, type ResolvedLink } from "../siteLinks";
import { loggableJobs } from "../dailyLog/store";
import { linkLabel, nameWithoutAmounts } from "../dailyLog/money";
import { fromSydneyLocal } from "../shiftTimes";
import { mediaOn } from "../media/store";
import { MEDIA_LIMITS } from "../media/rules";
import { readSiteDocFile } from "./files";
import { readSignature, type Signature } from "./checks";
import {
  LIMITS, SAME_SIGNATURE, allDifferent, allocateNumber, crewList, currentSwms, linkMayUse, mondayOf, parseRecord, parseSignOn, personKey, pickCrew,
  recordLabel, sydneyDay, topicLabel, type CrewRow, type PrestartInput, type ToolboxInput,
} from "./rules";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };
export const sydneyMidnight = (day: string) => fromSydneyLocal(`${day}T00:00`) ?? new Date(`${day}T00:00:00.000Z`);
const clock = (d: Date | null) => (d ? d.toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }) : null);
const dayText = (day: string) => new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
export const jsonList = (s: string | null | undefined): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
type Fail = { error: string; status: number };

// One write at a time on this server (the day's caps, the "Pre-start 2" number, the INC- number and the one-a-person
// checks are each read and written together). The unique indexes are the backstop across processes.
const shared = globalThis as unknown as { __siteDocsChain?: Promise<unknown> };
export function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = (shared.__siteDocsChain ?? Promise.resolve()).then(f, f);
  shared.__siteDocsChain = run.catch(() => undefined);
  return run;
}

// ---------- the link ----------

// A link that can use site documents: a person's SUPERVISOR link, or a HANDOVER link (its one job). resolveLink never
// accepts DRIVER or POSTER; OFFICE (and the yard's shared link) are refused here.
export async function resolveSiteDocsLink(token: unknown): Promise<ResolvedLink | null> {
  const link = await resolveLink(token);
  return link && linkMayUse(link) ? link : null;
}

export async function docJobs(link: ResolvedLink, now = new Date()) {
  const jobs = await loggableJobs(link, now);
  return jobs.map((j) => ({
    id: j.id, projectId: j.projectId ?? null, day: isoDay(j.date), night: j.shift === "NIGHT",
    projectName: j.project?.name ?? j.title, jobNo: j.project?.jobNo ?? null,
  }));
}
export type DocJob = Awaited<ReturnType<typeof docJobs>>[number];
export async function docJob(link: ResolvedLink, jobId: unknown, now = new Date()): Promise<DocJob | null> {
  if (typeof jobId !== "string") return null;
  return (await docJobs(link, now)).find((j) => j.id === jobId) ?? null;
}

const CREW_SELECT = { id: true, jobId: true, resourceId: true, workerName: true, company: true, place: true, status: true, removedAt: true, signInAt: true, signOutAt: true } as const;
type Crew = CrewRow & { signInAt: Date; signOutAt: Date | null };
// The job's own sign-ins (read only), as the crew picker's list: one a person, never the link's own person.
export async function crewOf(jobId: string, selfId: string | null): Promise<Crew[]> {
  const rows = await prisma.siteAttendance.findMany({ where: { jobId, place: null, removedAt: null, status: { not: "REJECTED" } }, select: CREW_SELECT, orderBy: { signInAt: "asc" }, take: 300 });
  return crewList(rows, jobId, selfId);
}
const crewName = (c: { workerName: string }) => nameWithoutAmounts(c.workerName) || "Crew member";
const crewCompany = (c: { resourceId: string | null; company: string | null }) => (c.resourceId ? null : c.company ? nameWithoutAmounts(c.company) || null : null);

// ---------- the SWMS / plans for a project ----------

async function archivedIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const ev = await prisma.siteDocFileEvent.findMany({ where: { fileId: { in: ids }, action: "ARCHIVED" }, select: { fileId: true } });
  return new Set(ev.map((e) => e.fileId));
}
export async function projectSwms(projectId: string) {
  const versions = await prisma.siteDocFile.findMany({ where: { projectId, kind: "SWMS" }, select: { id: true, title: true, version: true, createdAt: true }, orderBy: { version: "desc" }, take: LIMITS.swmsVersions });
  const archived = await archivedIds(versions.map((v) => v.id));
  return { versions, archived, current: currentSwms(versions, archived) };
}
async function projectPlans(projectIds: string[]) {
  if (!projectIds.length) return [];
  const rows = await prisma.siteDocFile.findMany({ where: { projectId: { in: projectIds }, kind: "PLAN" }, select: { id: true, projectId: true, title: true, mime: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: LIMITS.plansPerProject });
  const archived = await archivedIds(rows.map((r) => r.id));
  return rows.filter((r) => !archived.has(r.id));
}
// The office's topic of the week (the newest row for the week), or null.
export async function topicFor(week: string) {
  return prisma.siteDocTopic.findFirst({ where: { week }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, week: true, title: true, points: true, fileId: true } });
}

// ---------- the view ----------

export type LinkCrewDTO = { id: string; name: string; company: string | null; staff: boolean; in: string | null; out: string | null; swmsSigned: boolean };
export type LinkRecordDTO = { id: string; kind: string; label: string; day: string; sentAt: string; title: string | null; signed: { name: string; late: boolean }[]; signedCrew: string[] };
export type LinkJobDTO = {
  id: string; label: string; day: string; night: boolean; projectName: string; jobNo: string | null; hasProject: boolean;
  crew: LinkCrewDTO[];
  plans: { id: string; title: string; kind: "pdf" | "image" }[];
  swms: { id: string; title: string; version: number; supervisorSigned: boolean; signedCount: number } | null;
  prestarts: LinkRecordDTO[]; toolboxes: LinkRecordDTO[]; toolboxDone: boolean;
};
export type LinkViewDTO = {
  on: true; supervisor: string; jobs: LinkJobDTO[];
  topic: { id: string; week: string; title: string; points: string[]; hasPdf: boolean } | null;
  incidents: { number: string; day: string; type: string; sentAt: string }[];
  week: string; limits: { crewPerSend: number; photos: number; people: number };
  media: { on: true; photoMaxBytes: number } | { on: false };
};

const RECORD_SELECT = {
  id: true, kind: true, seq: true, day: true, createdAt: true, topicTitle: true, content: true, jobId: true, projectId: true, week: true,
  signatures: { select: { name: true, late: true, attendanceId: true, role: true, personKey: true }, orderBy: { createdAt: "asc" } },
} as const;
type RecRow = { id: string; kind: string; seq: number; day: string; createdAt: Date; topicTitle: string | null; content: string; signatures: { name: string; late: boolean; attendanceId: string | null; role: string; personKey: string }[] };
// signedCrew: the ids of the crew list (today's sign-ins on the job) of the people already on it - matched by person.
function linkRecord(r: RecRow, crew: CrewRow[]): LinkRecordDTO {
  const keys = new Set(r.signatures.map((s) => s.personKey));
  let title: string | null = null;
  if (r.kind === "TOOLBOX") { try { title = (JSON.parse(r.content) as { title?: string }).title ?? r.topicTitle; } catch { title = r.topicTitle; } }
  return {
    id: r.id, kind: r.kind, label: recordLabel(r.kind, r.seq), day: r.day, sentAt: r.createdAt.toISOString(), title: title ? linkLabel(title, "Toolbox talk") : null,
    signed: r.signatures.map((s) => ({ name: s.role === "SUPERVISOR" ? `${linkLabel(s.name, "Supervisor")} (supervisor)` : linkLabel(s.name, "Crew member"), late: s.late })),
    signedCrew: crew.filter((c) => keys.has(personKey(c))).map((c) => c.id),
  };
}

// GET on the link: its jobs (crew, plans, the current SWMS and who's signed it, today's pre-starts, this week's
// toolbox talks), the topic of the week, its own incident reports (number, date and type ONLY), the limits.
export async function linkView(link: ResolvedLink, now = new Date()): Promise<LinkViewDTO> {
  const jobs = await docJobs(link, now);
  const week = mondayOf(sydneyDay(now));
  const pids = [...new Set(jobs.map((j) => j.projectId).filter((x): x is string => !!x))];
  const since = sydneyMidnight(addDays(sydneyDay(now), -LIMITS.sentDays));
  const [plans, topic, incidents, swmsBy] = await Promise.all([
    projectPlans(pids),
    topicFor(week),
    prisma.incidentReport.findMany({ where: { siteLinkId: link.id, createdAt: { gte: since } }, select: { number: true, day: true, type: true, createdAt: true }, orderBy: { number: "desc" }, take: 30 }),
    Promise.all(pids.map(async (pid) => [pid, await projectSwms(pid)] as const)).then((xs) => new Map(xs)),
  ]);
  const out: LinkJobDTO[] = [];
  for (const j of jobs) {
    const crew = await crewOf(j.id, link.person.id);
    const sw = j.projectId ? swmsBy.get(j.projectId)?.current ?? null : null;
    const signed = sw ? await prisma.swmsSignature.findMany({ where: { fileId: sw.id }, select: { personKey: true, role: true } }) : [];
    const signedKeys = new Set(signed.map((s) => s.personKey));
    // Today's pre-starts on this job; this week's toolbox talks on its project (or this job, with no project).
    const [pre, tbx] = await Promise.all([
      prisma.siteDocRecord.findMany({ where: { jobId: j.id, kind: "PRESTART" }, select: RECORD_SELECT, orderBy: { seq: "asc" }, take: 10 }),
      prisma.siteDocRecord.findMany({ where: { kind: "TOOLBOX", week: mondayOf(j.day), ...(j.projectId ? { projectId: j.projectId } : { jobId: j.id }) }, select: RECORD_SELECT, orderBy: { createdAt: "asc" }, take: 10 }),
    ]);
    out.push({
      id: j.id, day: j.day, night: j.night, label: `${linkLabel(j.projectName, "Job")}${j.night ? " (night)" : ""} · ${dayText(j.day)}`,
      projectName: linkLabel(j.projectName, "Job"), jobNo: j.jobNo ? linkLabel(j.jobNo, "") || null : null, hasProject: !!j.projectId,
      crew: crew.map((c) => ({ id: c.id, name: crewName(c), company: crewCompany(c), staff: !!c.resourceId, in: clock(c.signInAt), out: clock(c.signOutAt), swmsSigned: signedKeys.has(personKey(c)) })),
      plans: plans.filter((p) => p.projectId === j.projectId).map((p) => ({ id: p.id, title: linkLabel(p.title, "Plan"), kind: p.mime === "application/pdf" ? "pdf" : "image" })),
      swms: sw ? { id: sw.id, title: linkLabel(sw.title, "SWMS"), version: sw.version ?? 1, supervisorSigned: !!link.person.id && signedKeys.has(`R:${link.person.id}`), signedCount: signed.length } : null,
      prestarts: pre.map((r) => linkRecord(r, crew)), toolboxes: tbx.map((r) => linkRecord(r, crew)), toolboxDone: tbx.length > 0,
    });
  }
  return {
    on: true, supervisor: link.person.name, jobs: out, week,
    topic: topic ? { id: topic.id, week: topic.week, title: linkLabel(topic.title, "Topic of the week"), points: jsonList(topic.points).map((p) => linkLabel(p, "")).filter(Boolean), hasPdf: !!topic.fileId } : null,
    incidents: incidents.map((i) => ({ number: `INC-${String(i.number).padStart(4, "0")}`, day: i.day, type: i.type, sentAt: i.createdAt.toISOString() })),
    limits: { crewPerSend: LIMITS.crewPerSend, photos: LIMITS.photos, people: LIMITS.people },
    media: mediaOn() ? { on: true, photoMaxBytes: MEDIA_LIMITS.photoMaxBytes } : { on: false },
  };
}

// The tile on the link's home: "Toolbox talk done this week ✓" or "Due this week" (any of its jobs without one).
export async function tileState(link: ResolvedLink, now = new Date()): Promise<{ toolboxDue: boolean; jobs: number }> {
  const jobs = await docJobs(link, now);
  let due = false;
  for (const j of jobs) {
    const n = await prisma.siteDocRecord.count({ where: { kind: "TOOLBOX", week: mondayOf(j.day), ...(j.projectId ? { projectId: j.projectId } : { jobId: j.id }) } });
    if (!n) { due = true; break; }
  }
  return { toolboxDue: due, jobs: jobs.length };
}

// ---------- files to read ----------

// A plan (not archived) or the CURRENT SWMS of a project this link has a job on today - or null. Never another
// project's file, never a superseded or archived one, never a topic file (see topicFile).
export async function linkFile(link: ResolvedLink, fileId: string, now = new Date()) {
  if (!/^[a-z0-9]{10,40}$/.test(fileId)) return null;
  const f = await prisma.siteDocFile.findUnique({ where: { id: fileId }, select: { id: true, projectId: true, kind: true, title: true, fileName: true, mime: true } });
  if (!f || !f.projectId || (f.kind !== "PLAN" && f.kind !== "SWMS")) return null;
  const jobs = await docJobs(link, now);
  if (!jobs.some((j) => j.projectId === f.projectId)) return null;
  if ((await archivedIds([f.id])).size) return null;
  if (f.kind === "SWMS" && (await projectSwms(f.projectId)).current?.id !== f.id) return null;
  return { ...f, bytes: await readSiteDocFile(f.fileName) };
}
// This week's topic PDF only.
export async function topicFile(topicId: string, now = new Date()) {
  if (!/^[a-z0-9]{10,40}$/.test(topicId)) return null;
  const t = await topicFor(mondayOf(sydneyDay(now)));
  if (!t || t.id !== topicId || !t.fileId) return null;
  const f = await prisma.siteDocFile.findUnique({ where: { id: t.fileId }, select: { kind: true, title: true, fileName: true, mime: true } });
  if (!f || f.kind !== "TOPIC") return null;
  return { ...f, bytes: await readSiteDocFile(f.fileName) };
}

// ---------- caps ----------

async function todayCount(kind: "swms" | "records" | "lateSignOns" | "incidents", linkId: string, now: Date) {
  const since = { gte: sydneyMidnight(sydneyDay(now)) };
  if (kind === "swms") return prisma.swmsSignature.count({ where: { siteLinkId: linkId, createdAt: since } });
  if (kind === "records") return prisma.siteDocRecord.count({ where: { siteLinkId: linkId, createdAt: since } });
  if (kind === "lateSignOns") return prisma.siteDocSignature.count({ where: { siteLinkId: linkId, late: true, createdAt: since } });
  return prisma.incidentReport.count({ where: { siteLinkId: linkId, createdAt: since } });
}
export async function overCap(kind: keyof typeof LIMITS.perLinkDay, linkId: string, now: Date, adding = 1) {
  return (await todayCount(kind, linkId, now)) + adding > LIMITS.perLinkDay[kind];
}
const CAP_MESSAGE = "That's a lot for one day on this link - call the office.";
const isClash = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

// ---------- a SWMS sign-on ----------

// POST on the link: one person signs the current SWMS of the job's project - picked from today's crew on that job
// (or the supervisor themselves), ticked, signed. One a person a version.
export async function signSwms(link: ResolvedLink, body: Record<string, unknown>, now = new Date()): Promise<{ signed: { name: string; version: number } } | Fail> {
  if (!linkMayUse(link)) return { error: "This link can't do that.", status: 403 };
  const job = await docJob(link, body.jobId, now);
  if (!job) return { error: "That job isn't one of yours today.", status: 403 };
  if (!job.projectId) return { error: "This job has no project, so it has no SWMS.", status: 400 };
  const sw = (await projectSwms(job.projectId)).current;
  if (!sw || sw.id !== body.fileId) return { error: "That isn't the current SWMS any more - go back and open it again.", status: 409 };
  const p = parseSignOn(body, { allowSupervisor: true });
  if ("error" in p) return { error: p.error, status: 400 };
  let who: { key: string; resourceId: string | null; attendanceId: string | null; name: string; company: string | null; role: "CREW" | "SUPERVISOR" };
  if (p.supervisor) who = { key: `R:${link.person.id}`, resourceId: link.person.id, attendanceId: null, name: link.person.name, company: null, role: "SUPERVISOR" };
  else {
    const c = pickCrew(await crewOf(job.id, link.person.id), p.attendanceId);
    if ("error" in c) return { error: c.error, status: 400 };
    who = { key: personKey(c), resourceId: c.resourceId, attendanceId: c.id, name: crewName(c), company: crewCompany(c), role: "CREW" };
  }
  const sig = readSignature(p.signature, who.name);
  if ("error" in sig) return { error: sig.error, status: 400 };
  return serial(async () => {
    if (await overCap("swms", link.id, now)) return { error: CAP_MESSAGE, status: 429 };
    const already = await prisma.swmsSignature.findMany({ where: { fileId: sw.id }, select: { personKey: true, sha256: true } });
    if (already.some((a) => a.personKey === who.key)) return { error: `${who.name} has already signed this version.`, status: 409 };
    if (already.some((a) => a.sha256 === sig.sha256)) return { error: SAME_SIGNATURE, status: 400 };
    try {
      await prisma.swmsSignature.create({
        data: {
          fileId: sw.id, projectId: job.projectId!, version: sw.version ?? 1, role: who.role, personKey: who.key, resourceId: who.resourceId, attendanceId: who.attendanceId,
          name: who.name.slice(0, 80), company: who.company?.slice(0, 80) ?? null, understood: true, png: sig.png, bytes: sig.bytes, sha256: sig.sha256,
          jobId: job.id, siteLinkId: link.id, linkKind: link.kind, runBy: link.person.name.slice(0, 80),
        },
      });
    } catch (e) {
      if (isClash(e)) return { error: `${who.name} has already signed this version.`, status: 409 };
      throw e;
    }
    return { signed: { name: linkLabel(who.name, "Crew member"), version: sw.version ?? 1 } };
  });
}

// ---------- a pre-start meeting / toolbox talk ----------

type CheckedCrew = { c: Crew; sig: Signature };
async function checkCrewSigs(jobId: string, selfId: string | null, list: { attendanceId: string; signature: string }[]): Promise<CheckedCrew[] | { error: string }> {
  const crew = await crewOf(jobId, selfId);
  const out: CheckedCrew[] = [];
  for (const x of list) {
    const c = pickCrew(crew, x.attendanceId);
    if ("error" in c) return c;
    const sig = readSignature(x.signature, crewName(c));
    if ("error" in sig) return sig;
    out.push({ c, sig });
  }
  if (new Set(out.map((x) => personKey(x.c))).size !== out.length) return { error: "Someone is on the list twice." };
  return out;
}

// POST on the link: Send a pre-start meeting or a toolbox talk - checked in full first (the job is this link's today,
// every crew member is one of that job's sign-ins today and ticked, every signature's bytes, the topic of the week is
// this week's), then one at a time: the day's cap, its number on the job ("Pre-start 2") and the one create with every
// signature. Locked once sent.
export async function sendRecord(link: ResolvedLink, body: Record<string, unknown>, now = new Date()): Promise<{ record: LinkRecordDTO } | Fail> {
  if (!linkMayUse(link)) return { error: "This link can't do that.", status: 403 };
  const p = parseRecord(body);
  if ("error" in p) return { error: p.error, status: 400 };
  const job = await docJob(link, p.jobId, now);
  if (!job) return { error: "That job isn't one of yours today.", status: 403 };
  const crew = await checkCrewSigs(job.id, link.person.id, p.crew);
  if ("error" in crew) return { error: crew.error, status: 400 };
  const sup = readSignature(p.supervisorSignature, "Supervisor");
  if ("error" in sup) return { error: sup.error, status: 400 };
  if (!allDifferent([...crew.map((x) => x.sig), sup])) return { error: SAME_SIGNATURE, status: 400 };
  let content: string, topicId: string | null = null, topicTitle: string | null = null;
  if (p.kind === "PRESTART") content = JSON.stringify((p as PrestartInput).topics.map((t) => ({ key: t.key, label: topicLabel(t.key), notes: t.notes })));
  else {
    const t = p as ToolboxInput;
    let officePoints: string[] = [];
    let title = t.title;
    if (t.source === "OFFICE") {
      const cur = await topicFor(mondayOf(sydneyDay(now)));
      if (!cur || cur.id !== t.topicId) return { error: "The topic of the week has changed - go back and open it again.", status: 409 };
      topicId = cur.id; topicTitle = cur.title; title = cur.title; officePoints = jsonList(cur.points);
    }
    content = JSON.stringify({ source: t.source, title, officePoints, points: t.points, sitePoints: t.sitePoints });
    topicTitle = topicTitle ?? title;
  }
  const made = await serial(async (): Promise<{ id: string } | Fail> => {
    if (await overCap("records", link.id, now)) return { error: CAP_MESSAGE, status: 429 };
    const { row } = await allocateNumber(
      async () => (await prisma.siteDocRecord.aggregate({ where: { jobId: job.id, kind: p.kind }, _max: { seq: true } }))._max.seq ?? 0,
      (seq) => prisma.siteDocRecord.create({
        data: {
          kind: p.kind, seq, jobId: job.id, projectId: job.projectId, day: job.day, week: mondayOf(job.day), projectName: job.projectName.slice(0, 200), jobNo: job.jobNo,
          content, notes: p.notes, topicId, topicTitle: topicTitle?.slice(0, 200) ?? null, supervisorName: link.person.name.slice(0, 80), supervisorResourceId: link.person.id,
          siteLinkId: link.id, linkKind: link.kind,
          signatures: {
            create: [
              ...crew.map(({ c, sig }) => ({ role: "CREW", personKey: personKey(c), resourceId: c.resourceId, attendanceId: c.id, name: crewName(c).slice(0, 80), company: crewCompany(c)?.slice(0, 80) ?? null, understood: true, late: false, png: sig.png, bytes: sig.bytes, sha256: sig.sha256, siteLinkId: link.id })),
              { role: "SUPERVISOR", personKey: `R:${link.person.id}`, resourceId: link.person.id, attendanceId: null, name: link.person.name.slice(0, 80), company: null, understood: true, late: false, png: sup.png, bytes: sup.bytes, sha256: sup.sha256, siteLinkId: link.id },
            ],
          },
        },
        select: { id: true },
      }),
    );
    return row;
  });
  if ("error" in made) return made;
  const r = await prisma.siteDocRecord.findUnique({ where: { id: made.id }, select: RECORD_SELECT });
  return { record: linkRecord(r!, await crewOf(job.id, link.person.id)) };
}

// POST on the link: a late arrival signs on to a sent pre-start / toolbox talk - an added signature (late), never an
// edit. The record's job must be one of this link's today; the person one of that job's sign-ins, not already on it.
export async function lateSignOn(link: ResolvedLink, recordId: string, body: Record<string, unknown>, now = new Date()): Promise<{ record: LinkRecordDTO } | Fail> {
  if (!linkMayUse(link)) return { error: "This link can't do that.", status: 403 };
  if (!/^[a-z0-9]{10,40}$/.test(recordId)) return { error: "not found", status: 404 };
  const rec = await prisma.siteDocRecord.findUnique({ where: { id: recordId }, select: { id: true, jobId: true } });
  if (!rec) return { error: "not found", status: 404 };
  const job = await docJob(link, rec.jobId, now);
  if (!job) return { error: "That isn't one of your jobs today.", status: 403 };
  const p = parseSignOn(body, { allowSupervisor: false });
  if ("error" in p) return { error: p.error, status: 400 };
  const c = pickCrew(await crewOf(job.id, link.person.id), p.attendanceId);
  if ("error" in c) return { error: c.error, status: 400 };
  const sig = readSignature(p.signature, crewName(c));
  if ("error" in sig) return { error: sig.error, status: 400 };
  const key = personKey(c);
  const done = await serial(async (): Promise<true | Fail> => {
    if (await overCap("lateSignOns", link.id, now)) return { error: CAP_MESSAGE, status: 429 };
    const on = await prisma.siteDocSignature.findMany({ where: { recordId: rec.id }, select: { personKey: true, sha256: true } });
    if (on.some((s) => s.personKey === key)) return { error: `${crewName(c)} has already signed on.`, status: 409 };
    if (on.some((s) => s.sha256 === sig.sha256)) return { error: SAME_SIGNATURE, status: 400 };
    try {
      await prisma.siteDocSignature.create({
        data: { recordId: rec.id, role: "CREW", personKey: key, resourceId: c.resourceId, attendanceId: c.id, name: crewName(c).slice(0, 80), company: crewCompany(c)?.slice(0, 80) ?? null, understood: true, late: true, png: sig.png, bytes: sig.bytes, sha256: sig.sha256, siteLinkId: link.id },
      });
    } catch (e) {
      if (isClash(e)) return { error: `${crewName(c)} has already signed on.`, status: 409 };
      throw e;
    }
    return true;
  });
  if (done !== true) return done;
  const r = await prisma.siteDocRecord.findUnique({ where: { id: rec.id }, select: RECORD_SELECT });
  return { record: linkRecord(r!, await crewOf(job.id, link.person.id)) };
}

// ---------- F. truck & plant pre-starts on the job today (read only) ----------

// The trucks and Lobos-owned machines booked on this job (its board allocations), with today's pre-start / post-check
// from the existing checks (lib/prestart/): who did it (first name), when, how many faults. Words and times only -
// money-free (no rates, no hire figures).
export async function jobPrestarts(link: ResolvedLink, jobId: string, now = new Date()) {
  const job = await docJob(link, jobId, now);
  if (!job) return null;
  const booked = await prisma.assignment.findMany({
    where: { jobId: job.id, resource: { OR: [{ type: "VEHICLE" }, { type: "EQUIPMENT", ownership: "OWNED" }] } },
    select: { resourceId: true, resource: { select: { name: true, type: true } } },
    take: 60,
  });
  const ids = booked.map((b) => b.resourceId);
  const [truckIns, sessions] = ids.length ? await Promise.all([
    prisma.siteAttendance.findMany({ where: { place: "VEHICLE", vehicleId: { in: ids }, date: job.day, removedAt: null, status: { not: "REJECTED" } }, select: { id: true, vehicleId: true } }),
    prisma.plantCheckSession.findMany({ where: { resourceId: { in: ids }, day: job.day }, select: { id: true } }),
  ]) : [[], []];
  const checks = truckIns.length || sessions.length ? await prisma.prestartCheck.findMany({
    where: { OR: [...(truckIns.length ? [{ attendanceId: { in: truckIns.map((t) => t.id) } }] : []), ...(sessions.length ? [{ sessionId: { in: sessions.map((s) => s.id) } }] : [])] },
    select: { resourceId: true, kind: true, personName: true, faultCount: true, createdAt: true }, orderBy: { createdAt: "asc" },
  }) : [];
  const first = (n: string) => nameWithoutAmounts(n).split(/\s+/)[0] || "Someone";
  return booked.map((b) => {
    const mine = checks.filter((c) => c.resourceId === b.resourceId);
    const pre = mine.filter((c) => c.kind === "PRE"), post = mine.filter((c) => c.kind === "POST");
    return {
      machine: linkLabel(b.resource.name, b.resource.type === "VEHICLE" ? "Truck" : "Machine"), truck: b.resource.type === "VEHICLE",
      pre: pre.length ? { by: first(pre[0].personName), at: clock(pre[0].createdAt), faults: pre.reduce((a, c) => a + c.faultCount, 0) } : null,
      post: post.length ? { by: first(post[post.length - 1].personName), at: clock(post[post.length - 1].createdAt), faults: post.reduce((a, c) => a + c.faultCount, 0) } : null,
    };
  }).sort((a, b) => Number(!!a.pre) - Number(!!b.pre) || a.machine.localeCompare(b.machine));
}
