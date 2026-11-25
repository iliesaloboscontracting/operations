// Site documents, the office side (Ilies approved 25 Nov 2026) - /site-documents for Managers, Admins (the owner is
// one) and the coordinator (guardSiteDocs). Per project: plans & drawings (upload, archive - never delete), SWMS
// versions (a new upload is the next version; older ones are kept, superseded) with the sign-on register and "on site
// today and not signed the current SWMS"; the pre-start and toolbox talk records; the topic of the week. Signatures are
// served only to these logins, never to the Building Agent (the routes check). Nothing here updates or deletes a file,
// a record, a signature or a version. No price anywhere. Incidents are NOT here - they're owner / DIRECTOR only.
import { createHash } from "crypto";
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { BUILDING_AGENT_EMAIL } from "../session";
import { pushToSiteLinks } from "../push";
import { liveLinks } from "../pushLinks";
import { checkUpload } from "./checks";
import { newFileName, readSiteDocFile, writeSiteDocFile } from "./files";
import { crewOf, jsonList, projectSwms, serial, sydneyMidnight } from "./store";
import {
  LIMITS, allocateNumber, isAgentEmail, newSwmsAlert, newSwmsRecipients, signedAfterSignOut, siteDocsOn, isRecordKind, mondayOf, parseArchive, parseFileMeta, parseTopic, personKey, recordLabel, safeFileName, sydneyDay, topicLabel,
} from "./rules";

type Fail = { error: string; status: number };
type Who = { id: string; name: string; role: string; email: string };
const ID = /^[a-z0-9]{10,40}$/;
export const isAgent = (who: { email: string }) => isAgentEmail(who.email, BUILDING_AGENT_EMAIL);

async function archivedMap(ids: string[]) {
  if (!ids.length) return new Map<string, { note: string; by: string; at: string }>();
  const ev = await prisma.siteDocFileEvent.findMany({ where: { fileId: { in: ids }, action: "ARCHIVED" }, select: { fileId: true, note: true, byName: true, createdAt: true } });
  return new Map(ev.map((e) => [e.fileId, { note: e.note, by: e.byName, at: e.createdAt.toISOString() }]));
}

// SD-005 (Ilies approved 26 Nov 2026, detective only): a crew signature made after that person's sign-in was signed out
// is flagged ("signed after they signed out") - the sign-in is only read; nothing is stored or refused.
async function withAfterSignOut<T extends { attendanceId: string | null; createdAt: Date }>(sigs: T[]): Promise<(T & { afterSignOut: boolean })[]> {
  const ids = [...new Set(sigs.map((s) => s.attendanceId).filter((x): x is string => !!x))];
  const outs = ids.length ? await prisma.siteAttendance.findMany({ where: { id: { in: ids } }, select: { id: true, signOutAt: true } }) : [];
  const by = new Map(outs.map((a) => [a.id, a.signOutAt]));
  return sigs.map((s) => ({ ...s, afterSignOut: s.attendanceId ? signedAfterSignOut(s.createdAt, by.get(s.attendanceId)) : false }));
}

// ---------- projects ----------

export async function officeProjects() {
  const [projects, files, records] = await Promise.all([
    prisma.project.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] } }, select: { id: true, name: true, jobNo: true, status: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.siteDocFile.groupBy({ by: ["projectId", "kind"], where: { projectId: { not: null } }, _count: { _all: true } }),
    prisma.siteDocRecord.groupBy({ by: ["projectId"], where: { projectId: { not: null } }, _count: { _all: true } }),
  ]);
  const extra = [...new Set([...files.map((f) => f.projectId), ...records.map((r) => r.projectId)].filter((x): x is string => !!x && !projects.some((p) => p.id === x)))];
  const more = extra.length ? await prisma.project.findMany({ where: { id: { in: extra } }, select: { id: true, name: true, jobNo: true, status: true } }) : [];
  return [...projects, ...more].map((p) => ({
    id: p.id, name: p.name, jobNo: p.jobNo, status: p.status,
    plans: files.find((f) => f.projectId === p.id && f.kind === "PLAN")?._count._all ?? 0,
    swmsVersions: files.find((f) => f.projectId === p.id && f.kind === "SWMS")?._count._all ?? 0,
    records: records.find((r) => r.projectId === p.id)?._count._all ?? 0,
  }));
}

// "On site today and not signed the current SWMS": everyone signed in on the project's jobs today (people only, not
// removed or rejected), less everyone who has signed the current version.
async function notSignedToday(projectId: string, fileId: string | null) {
  const today = todaySydney();
  const jobs = await prisma.job.findMany({ where: { projectId, date: new Date(`${today}T00:00:00.000Z`), cancelledAt: null }, select: { id: true } });
  const crew = (await Promise.all(jobs.map((j) => crewOf(j.id, null)))).flat();
  const signed = new Set(fileId ? (await prisma.swmsSignature.findMany({ where: { fileId }, select: { personKey: true } })).map((s) => s.personKey) : []);
  const seen = new Set<string>();
  const out: { name: string; company: string | null; signedIn: string }[] = [];
  for (const c of crew) {
    const k = personKey(c);
    if (signed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ name: c.workerName, company: c.resourceId ? null : c.company, signedIn: c.signInAt.toISOString() });
  }
  return out;
}

export async function officeProject(projectId: string) {
  if (!ID.test(projectId)) return null;
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, jobNo: true, client: true, address: true, status: true } });
  if (!p) return null;
  const files = await prisma.siteDocFile.findMany({ where: { projectId, kind: { in: ["PLAN", "SWMS"] } }, orderBy: [{ kind: "asc" }, { createdAt: "desc" }], take: LIMITS.plansPerProject + LIMITS.swmsVersions });
  const archived = await archivedMap(files.map((f) => f.id));
  const sw = await projectSwms(projectId);
  const counts = sw.versions.length ? await prisma.swmsSignature.groupBy({ by: ["fileId"], where: { fileId: { in: sw.versions.map((v) => v.id) } }, _count: { _all: true } }) : [];
  const fileDTO = (f: (typeof files)[number]) => ({
    id: f.id, kind: f.kind, title: f.title, version: f.version, originalName: f.originalName, mime: f.mime, bytes: f.bytes, uploadedBy: f.uploadedBy, at: f.createdAt.toISOString(),
    archived: archived.get(f.id) ?? null,
  });
  return {
    project: p,
    plans: files.filter((f) => f.kind === "PLAN").map(fileDTO),
    swms: files.filter((f) => f.kind === "SWMS").sort((a, b) => (b.version ?? 0) - (a.version ?? 0)).map((f) => ({
      ...fileDTO(f), current: sw.current?.id === f.id, superseded: !!sw.current && (f.version ?? 0) < (sw.current.version ?? 0) && !archived.has(f.id),
      signed: counts.find((c) => c.fileId === f.id)?._count._all ?? 0,
    })),
    currentSwmsId: sw.current?.id ?? null,
    notSigned: sw.current ? await notSignedToday(projectId, sw.current.id) : [],
    records: await recordList({ projectId }),
  };
}

// ---------- files ----------

// Upload a plan / drawing or a SWMS (the next version) for a project - checked by its own bytes first. The file is
// written under a new random name (never over another), then its row; a SWMS version number comes from max + 1 with
// the unique index as the backstop.
export async function uploadFile(who: Who, body: Record<string, unknown>): Promise<{ file: { id: string; version: number | null } } | Fail> {
  const m = parseFileMeta(body);
  if ("error" in m) return { error: m.error, status: 400 };
  const f = checkUpload(body.dataUrl, body.fileName, m.kind);
  if ("error" in f) return { error: f.error, status: 400 };
  const project = await prisma.project.findUnique({ where: { id: m.projectId }, select: { id: true } });
  if (!project) return { error: "That project isn't there.", status: 404 };
  return serial(async () => {
    const since = sydneyMidnight(todaySydney());
    if ((await prisma.siteDocFile.count({ where: { uploadedById: who.id, createdAt: { gte: since } } })) >= LIMITS.officeUploadsPerDay) return { error: "That's a lot of uploads today - try again tomorrow.", status: 429 };
    const max = m.kind === "SWMS" ? LIMITS.swmsVersions : LIMITS.plansPerProject;
    if ((await prisma.siteDocFile.count({ where: { projectId: m.projectId, kind: m.kind } })) >= max) return { error: `This project already has ${max} of those - archive old ones or call the office.`, status: 409 };
    const fileName = newFileName(f.ext);
    await writeSiteDocFile(fileName, f.bytes);
    const sha256 = createHash("sha256").update(f.bytes).digest("hex");
    const data = { projectId: m.projectId, kind: m.kind, title: m.title, fileName, originalName: f.name, mime: f.mime, bytes: f.bytes.length, sha256, uploadedById: who.id, uploadedBy: who.name.slice(0, 80) };
    if (m.kind === "PLAN") {
      const row = await prisma.siteDocFile.create({ data: { ...data, version: null }, select: { id: true, version: true } });
      return { file: row };
    }
    const { row } = await allocateNumber(
      async () => (await prisma.siteDocFile.aggregate({ where: { projectId: m.projectId, kind: "SWMS" }, _max: { version: true } }))._max.version ?? 0,
      (version) => prisma.siteDocFile.create({ data: { ...data, version }, select: { id: true, version: true } }),
    );
    // The supervisors on the project today and the next 7 days are told on their phones (never holds up the upload).
    void alertNewSwms(m.projectId, row.version ?? 1).catch((e) => console.error("swms alert", e instanceof Error ? e.message : "failed"));
    return { file: row };
  });
}

// Archive a file: hidden from the link, never deleted - its own event row (who, when, why), once.
export async function archiveFile(who: Who, id: string, body: Record<string, unknown>): Promise<{ archived: true } | Fail> {
  if (!ID.test(id)) return { error: "not found", status: 404 };
  const a = parseArchive(body);
  if ("error" in a) return { error: a.error, status: 400 };
  const f = await prisma.siteDocFile.findUnique({ where: { id }, select: { id: true } });
  if (!f) return { error: "not found", status: 404 };
  try {
    await prisma.siteDocFileEvent.create({ data: { fileId: id, action: "ARCHIVED", note: a.note, byUserId: who.id, byName: who.name.slice(0, 80) } });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "P2002") return { error: "It's already archived.", status: 409 };
    throw e;
  }
  return { archived: true };
}

export async function officeFile(id: string) {
  if (!ID.test(id)) return null;
  const f = await prisma.siteDocFile.findUnique({ where: { id }, select: { title: true, fileName: true, mime: true, kind: true, version: true } });
  if (!f) return null;
  const ext = f.mime === "application/pdf" ? "pdf" : f.mime === "image/png" ? "png" : "jpg";
  return { mime: f.mime, name: safeFileName(f.kind === "SWMS" ? `${f.title} v${f.version ?? 1}` : f.title, ext), bytes: await readSiteDocFile(f.fileName) };
}

// ---------- the SWMS register ----------

export async function swmsRegister(fileId: string) {
  if (!ID.test(fileId)) return null;
  const f = await prisma.siteDocFile.findUnique({ where: { id: fileId }, select: { id: true, projectId: true, kind: true, title: true, version: true, createdAt: true, uploadedBy: true } });
  if (!f || f.kind !== "SWMS" || !f.projectId) return null;
  const [p, sigs, sw] = await Promise.all([
    prisma.project.findUnique({ where: { id: f.projectId }, select: { id: true, name: true, jobNo: true, address: true } }),
    prisma.swmsSignature.findMany({ where: { fileId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, name: true, company: true, createdAt: true, runBy: true, understood: true, attendanceId: true } }),
    projectSwms(f.projectId),
  ]);
  return {
    file: { id: f.id, title: f.title, version: f.version, uploadedAt: f.createdAt.toISOString(), uploadedBy: f.uploadedBy, current: sw.current?.id === f.id, archived: sw.archived.has(f.id) },
    project: p,
    signatures: await withAfterSignOut(sigs).then((xs) => xs.map((s) => ({ id: s.id, role: s.role, name: s.name, company: s.company, at: s.createdAt.toISOString(), runBy: s.runBy, understood: s.understood, afterSignOut: s.afterSignOut }))),
    notSigned: sw.current?.id === f.id ? await notSignedToday(f.projectId, f.id) : [],
  };
}

// ---------- records ----------

export async function recordList(f: { projectId?: string; kind?: string }) {
  const rows = await prisma.siteDocRecord.findMany({
    where: { ...(f.projectId ? { projectId: f.projectId } : {}), ...(isRecordKind(f.kind) ? { kind: f.kind } : {}) },
    orderBy: { createdAt: "desc" }, take: 300,
    select: { id: true, kind: true, seq: true, day: true, projectId: true, projectName: true, jobNo: true, supervisorName: true, topicTitle: true, createdAt: true, signatures: { select: { role: true, late: true } } },
  });
  return rows.map((r) => ({
    id: r.id, kind: r.kind, label: recordLabel(r.kind, r.seq), day: r.day, projectId: r.projectId, project: r.projectName, jobNo: r.jobNo, supervisor: r.supervisorName,
    title: r.kind === "TOOLBOX" ? r.topicTitle : null, sentAt: r.createdAt.toISOString(),
    crew: r.signatures.filter((s) => s.role === "CREW").length, late: r.signatures.filter((s) => s.late).length,
  }));
}
export async function recordDetail(id: string, who: Who) {
  if (!ID.test(id)) return null;
  const r = await prisma.siteDocRecord.findUnique({
    where: { id },
    select: {
      id: true, kind: true, seq: true, day: true, week: true, projectId: true, projectName: true, jobNo: true, content: true, notes: true, topicTitle: true, supervisorName: true, linkKind: true, createdAt: true,
      signatures: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, name: true, company: true, understood: true, late: true, createdAt: true, attendanceId: true } },
    },
  });
  if (!r) return null;
  let content: unknown = null;
  try { content = JSON.parse(r.content); } catch { content = null; }
  const topics = r.kind === "PRESTART" && Array.isArray(content)
    ? (content as { key?: string; notes?: string | null }[]).filter((t) => typeof t.key === "string").map((t) => ({ key: t.key!, label: topicLabel(t.key!), notes: t.notes ?? null }))
    : [];
  const tb = r.kind === "TOOLBOX" && content && typeof content === "object" && !Array.isArray(content) ? (content as { source?: string; title?: string; officePoints?: string[]; points?: string; sitePoints?: string | null }) : null;
  return {
    id: r.id, kind: r.kind, label: recordLabel(r.kind, r.seq), day: r.day, week: r.week, projectId: r.projectId, project: r.projectName, jobNo: r.jobNo,
    notes: r.notes, supervisor: r.supervisorName, linkKind: r.linkKind, sentAt: r.createdAt.toISOString(),
    topics,
    toolbox: tb ? { source: tb.source === "OFFICE" ? "OFFICE" : "OWN", title: tb.title ?? r.topicTitle ?? "", officePoints: Array.isArray(tb.officePoints) ? tb.officePoints.filter((x) => typeof x === "string") : [], points: tb.points ?? "", sitePoints: tb.sitePoints ?? null } : null,
    signatures: (await withAfterSignOut(r.signatures)).map((s) => ({ id: s.id, role: s.role, name: s.name, company: s.company, understood: s.understood, late: s.late, at: s.createdAt.toISOString(), afterSignOut: s.afterSignOut })),
    signaturesHidden: isAgent(who),
  };
}

export async function recordSignaturePng(recordId: string, sigId: string): Promise<Buffer | null> {
  if (!ID.test(recordId) || !ID.test(sigId)) return null;
  const s = await prisma.siteDocSignature.findUnique({ where: { id: sigId }, select: { recordId: true, png: true } });
  return s && s.recordId === recordId ? Buffer.from(s.png) : null;
}
export async function swmsSignaturePng(sigId: string): Promise<Buffer | null> {
  if (!ID.test(sigId)) return null;
  const s = await prisma.swmsSignature.findUnique({ where: { id: sigId }, select: { png: true } });
  return s ? Buffer.from(s.png) : null;
}

// ---------- the topic of the week ----------

export async function topicList(now = new Date()) {
  const week = mondayOf(sydneyDay(now));
  const rows = await prisma.siteDocTopic.findMany({ where: { week: { gte: mondayOf(new Date(Date.now() - 84 * 864e5).toISOString().slice(0, 10)) } }, orderBy: [{ week: "desc" }, { createdAt: "desc" }], take: 200 });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.week)) latest.set(r.week, r);
  return {
    week, nextWeek: mondayOf(new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10)),
    topics: [...latest.values()].map((t) => ({ id: t.id, week: t.week, title: t.title, points: jsonList(t.points), fileId: t.fileId, by: t.byName, at: t.createdAt.toISOString() })),
  };
}
// Set the topic for a week: a new row (the newest is the one used), with an optional PDF saved as a TOPIC file.
export async function setTopic(who: Who, body: Record<string, unknown>): Promise<{ topic: { id: string; week: string } } | Fail> {
  const t = parseTopic(body);
  if ("error" in t) return { error: t.error, status: 400 };
  const pdf = body.dataUrl ? checkUpload(body.dataUrl, body.fileName, "TOPIC") : null;
  if (pdf && "error" in pdf) return { error: pdf.error, status: 400 };
  return serial(async () => {
    if ((await prisma.siteDocTopic.count({ where: { week: t.week } })) >= LIMITS.topicsPerWeek) return { error: "That week's topic has been set a lot of times - call the office.", status: 429 };
    let fileId: string | null = null;
    if (pdf) {
      const since = sydneyMidnight(todaySydney());
      if ((await prisma.siteDocFile.count({ where: { uploadedById: who.id, createdAt: { gte: since } } })) >= LIMITS.officeUploadsPerDay) return { error: "That's a lot of uploads today - try again tomorrow.", status: 429 };
      const fileName = newFileName(pdf.ext);
      await writeSiteDocFile(fileName, pdf.bytes);
      const sha256 = createHash("sha256").update(pdf.bytes).digest("hex");
      fileId = (await prisma.siteDocFile.create({ data: { projectId: null, kind: "TOPIC", title: t.title, version: null, fileName, originalName: pdf.name, mime: pdf.mime, bytes: pdf.bytes.length, sha256, uploadedById: who.id, uploadedBy: who.name.slice(0, 80) }, select: { id: true } })).id;
    } else if (typeof body.keepFileId === "string" && ID.test(body.keepFileId)) {
      // Re-setting a week's topic keeps its PDF when asked.
      const f = await prisma.siteDocFile.findUnique({ where: { id: body.keepFileId }, select: { id: true, kind: true } });
      if (f?.kind === "TOPIC") fileId = f.id;
    }
    const row = await prisma.siteDocTopic.create({ data: { week: t.week, title: t.title, points: JSON.stringify(t.points), fileId, byUserId: who.id, byName: who.name.slice(0, 80) }, select: { id: true, week: true } });
    return { topic: row };
  });
}

// The coordinator's "Site documents" card (Ilies, 25 Nov 2026): across the projects with a job today - how many have no
// SWMS from the office, and how many people on site today haven't signed their project's current SWMS. A handful of
// queries a project with a job today (no more than the board's day) - names stay on the project page.
export async function officeSummary() {
  const today = todaySydney();
  const jobs = await prisma.job.findMany({ where: { date: new Date(`${today}T00:00:00.000Z`), projectId: { not: null }, cancelledAt: null, status: { notIn: ["INACTIVE", "STOOD_DOWN", "CANCELLED"] } }, select: { projectId: true }, take: 300 });
  const pids = [...new Set(jobs.map((j) => j.projectId!))].slice(0, 80);
  let notSigned = 0, noSwms = 0;
  const projects: { id: string; notSigned: number; hasSwms: boolean }[] = [];
  for (const pid of pids) {
    const cur = (await projectSwms(pid)).current;
    const n = cur ? (await notSignedToday(pid, cur.id)).length : 0;
    if (!cur) noSwms++;
    notSigned += n;
    projects.push({ id: pid, notSigned: n, hasSwms: !!cur });
  }
  return { today, projectsToday: pids.length, noSwms, notSigned, projects };
}

// ---------- the new SWMS alert (Ilies, 26 Nov 2026) ----------

// "New SWMS for <project> (v3) - get the crew to sign it at the next pre-start." to the live SUPERVISOR links of the
// people booked on the project's jobs today and the next 7 days, and those jobs' hand-over links - their own phones
// (the existing link push, lib/push.ts pushToSiteLinks; a link with no phone turned on gets nothing). Words only. ->
// devices reached. SITE_DOCS=off: none.
export async function alertNewSwms(projectId: string, version: number, now = new Date()): Promise<number> {
  if (!siteDocsOn()) return 0;
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!p) return 0;
  const msg = newSwmsAlert(p.name, version);
  if (!msg) return 0;
  const today = sydneyDay(now);
  const until = new Date(`${today}T00:00:00.000Z`); until.setUTCDate(until.getUTCDate() + 7);
  const jobs = await prisma.job.findMany({
    where: { projectId, cancelledAt: null, status: { notIn: ["INACTIVE", "STOOD_DOWN", "CANCELLED", "COMPLETED"] }, date: { gte: new Date(`${today}T00:00:00.000Z`), lte: until } },
    select: { id: true, assignments: { select: { resourceId: true } } }, take: 200,
  });
  if (!jobs.length) return 0;
  const crewIds = [...new Set(jobs.flatMap((j) => j.assignments.map((a) => a.resourceId)))];
  const links = await prisma.siteLink.findMany({
    where: liveLinks({ OR: [{ kind: "SUPERVISOR", resourceId: { in: crewIds } }, { kind: "HANDOVER", jobId: { in: jobs.map((j) => j.id) } }] }, now),
    select: { id: true, kind: true, resourceId: true, jobId: true },
  });
  const to = newSwmsRecipients(jobs.map((j) => ({ id: j.id, crewIds: j.assignments.map((a) => a.resourceId) })), links);
  return to.length ? pushToSiteLinks(to, msg, "normal") : 0;
}