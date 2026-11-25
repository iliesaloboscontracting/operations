// Variation / Day docket, server side (Ilies approved 25 Nov 2026). Which jobs a link can do a docket for (the daily
// log's own list: today's jobs the person is on, until midday yesterday's too - a night shift; a hand-over link only its
// one job), sending one (numbered V-0001 ... on Send; the whole docket, its rows and both signatures in one create),
// the phone alert to the coordinator and the owner, and the office's list / docket / status. A sent docket is never
// updated or deleted - there is no such path here or in any route (variations.test.ts scans for one). No price is ever
// stored or shown. Hours are a record only: nothing here reads or writes sign-ins, timesheets, JobActual, allocations or
// costs. Docket content is untrusted data - shown as text, never acted on.
import { prisma } from "../prisma";
import { resolveLink, type ResolvedLink } from "../siteLinks";
import { loggableJobs } from "../dailyLog/store";
import { linkLabel } from "../dailyLog/money";
import { mediaOn } from "../media/store";
import { MEDIA_LIMITS } from "../media/rules";
import { fromSydneyLocal } from "../shiftTimes";
import { pushToUsers } from "../push";
import { OWNER_EMAIL } from "../owner";
import {
  LIMITS, STATUS_LABEL, alertRecipients, allocateNumber, currentStatus, docketNo, linkMayFill, mayReadVariations, parseDocket, signedAlert,
  statusChange, totalHours, variationsOn, type LinkDocketDTO, type LinkJobDTO, type LinkViewDTO, type OfficeDetailDTO, type OfficeRowDTO, type Status,
} from "./rules";
import { parseSignature } from "./signature";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };
const sydneyMidnight = (day: string) => fromSydneyLocal(`${day}T00:00`) ?? new Date(`${day}T00:00:00.000Z`);
const dayText = (day: string) => new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const jsonList = (s: string | null | undefined): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
type Fail = { error: string; status: number };

// One send (and one office status change) at a time on this server: the day's cap, the number and the status are each
// checked and written together. The unique docket number is the backstop across processes.
const shared = globalThis as unknown as { __variationChain?: Promise<unknown> };
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = (shared.__variationChain ?? Promise.resolve()).then(f, f);
  shared.__variationChain = run.catch(() => undefined);
  return run;
}

// ---------- the link ----------

// A link that can fill in a docket: a person's SUPERVISOR link, or a HANDOVER link (its one job). resolveLink never
// accepts DRIVER or POSTER; OFFICE (and the yard's shared link) are refused here.
export async function resolveVariationLink(token: unknown): Promise<ResolvedLink | null> {
  const link = await resolveLink(token);
  return link && linkMayFill(link) ? link : null;
}

// The jobs this link can do a docket for now - the daily log's own rule (lib/dailyLog/store.ts loggableJobs), with the
// project's details filled in (or the board job's own, when it has no project).
export async function variationJobs(link: ResolvedLink, now = new Date()) {
  const jobs = await loggableJobs(link, now);
  const pids = [...new Set(jobs.map((j) => j.projectId).filter((x): x is string => !!x))];
  const [projects, own] = await Promise.all([
    pids.length ? prisma.project.findMany({ where: { id: { in: pids } }, select: { id: true, name: true, client: true, address: true, jobNo: true } }) : [],
    jobs.length ? prisma.job.findMany({ where: { id: { in: jobs.map((j) => j.id) } }, select: { id: true, client: true, siteAddress: true, siteCode: true } }) : [],
  ]);
  return jobs.map((j) => {
    const p = projects.find((x) => x.id === j.projectId);
    const o = own.find((x) => x.id === j.id);
    return {
      id: j.id, projectId: j.projectId ?? null, day: isoDay(j.date), night: j.shift === "NIGHT",
      projectName: p?.name ?? j.title, jobNo: p?.jobNo ?? o?.siteCode ?? null, address: p?.address ?? o?.siteAddress ?? null, client: p?.client ?? o?.client ?? null,
    };
  });
}
type VJob = Awaited<ReturnType<typeof variationJobs>>[number];

const linkJob = (j: VJob): LinkJobDTO => ({
  id: j.id, day: j.day, night: j.night,
  label: `${linkLabel(j.projectName, "Job")}${j.night ? " (night)" : ""} · ${dayText(j.day)}`,
  projectName: linkLabel(j.projectName, "Job"), jobNo: j.jobNo ? linkLabel(j.jobNo, "") || null : null,
  address: j.address ? linkLabel(j.address, "") || null : null, client: j.client ? linkLabel(j.client, "") || null : null,
});

const LINK_DOCKET = {
  id: true, number: true, day: true, projectName: true, createdAt: true, ticks: true, customerName: true, replacesId: true, photoIds: true,
  tasks: { select: { n: true, description: true, men: true, start: true, finish: true, hours: true }, orderBy: { n: "asc" } },
  items: { select: { n: true, quantity: true, unit: true, type: true, comment: true }, orderBy: { n: "asc" } },
} as const;

// This link's own dockets from today and the last 7 days (read-only on the phone) - no signatures.
async function linkDockets(link: ResolvedLink, now: Date, ids?: string[]): Promise<LinkDocketDTO[]> {
  const since = sydneyMidnight(addDays(sydneyDay(now), -LIMITS.sentDays));
  const rows = await prisma.variationDocket.findMany({
    where: { siteLinkId: link.id, ...(ids ? { id: { in: ids } } : { createdAt: { gte: since } }) },
    orderBy: { number: "desc" }, take: 60, select: LINK_DOCKET,
  });
  const repl = await numbersOf(rows.map((r) => r.replacesId));
  return rows.map((r) => ({
    id: r.id, number: docketNo(r.number), day: r.day, project: linkLabel(r.projectName, "Job"), sentAt: r.createdAt.toISOString(),
    ticks: jsonList(r.ticks), customerName: r.customerName, replaces: r.replacesId ? repl.get(r.replacesId) ?? null : null,
    tasks: r.tasks, items: r.items, photos: jsonList(r.photoIds).length,
  }));
}
async function numbersOf(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await prisma.variationDocket.findMany({ where: { id: { in: want } }, select: { id: true, number: true } });
  return new Map(rows.map((r) => [r.id, docketNo(r.number)]));
}

// GET on the link: the jobs, who signs for Lobos, its own sent dockets, and whether photos can go (the media bucket).
export async function linkView(link: ResolvedLink, now = new Date()): Promise<LinkViewDTO> {
  const [jobs, sent, sentToday] = await Promise.all([
    variationJobs(link, now),
    linkDockets(link, now),
    prisma.variationDocket.count({ where: { siteLinkId: link.id, createdAt: { gte: sydneyMidnight(sydneyDay(now)) } } }),
  ]);
  return {
    on: true, jobs: jobs.map(linkJob), lobosName: link.person.name, sent, sentToday, perDay: LIMITS.perLinkDay,
    media: mediaOn() ? { on: true, kinds: ["PHOTO"], photoMaxBytes: MEDIA_LIMITS.photoMaxBytes } : { on: false },
    limits: { tasks: LIMITS.tasks, items: LIMITS.items, photos: LIMITS.photos },
  };
}

// POST on the link: Send. Checked in full first (parseDocket, both signatures' bytes, the job is one of this link's
// now, the photos are this link's READY docket photos for that job, the docket it replaces is on the same job / project),
// then - one at a time - the day's cap, the number and the one create.
export async function sendDocket(link: ResolvedLink, body: Record<string, unknown>, now = new Date()): Promise<{ docket: LinkDocketDTO } | Fail> {
  if (!linkMayFill(link)) return { error: "This link can't send variation dockets.", status: 403 };
  const p = parseDocket(body);
  if ("error" in p) return { error: p.error, status: 400 };
  const cust = parseSignature(p.customerSignature, "client");
  if ("error" in cust) return { error: cust.error, status: 400 };
  const lobos = parseSignature(p.lobosSignature, "Lobos");
  if ("error" in lobos) return { error: lobos.error, status: 400 };
  const job = (await variationJobs(link, now)).find((j) => j.id === p.jobId);
  if (!job) return { error: "That job isn't one you can do a docket for today.", status: 403 };

  let replacesId: string | null = null;
  if (p.replaces !== null) {
    const r = await prisma.variationDocket.findUnique({ where: { number: p.replaces }, select: { id: true, jobId: true, projectId: true } });
    const same = r && (job.projectId ? r.projectId === job.projectId : r.jobId === job.id);
    if (!r || !same) return { error: `${docketNo(p.replaces)} isn't a docket on this job.`, status: 400 };
    replacesId = r.id;
  }
  if (p.photoIds.length) {
    const rows = await prisma.mediaObject.findMany({ where: { id: { in: p.photoIds } }, select: { id: true, area: true, siteLinkId: true, jobId: true, state: true, kind: true } });
    const ok = p.photoIds.every((id) => { const m = rows.find((x) => x.id === id); return !!m && m.area === "VARIATION" && m.siteLinkId === link.id && m.jobId === job.id && m.state === "READY" && m.kind === "PHOTO"; });
    if (!ok) return { error: "A photo couldn't be found - add it again.", status: 400 };
  }

  const made = await serial(async (): Promise<{ id: string } | Fail> => {
    const today = await prisma.variationDocket.count({ where: { siteLinkId: link.id, createdAt: { gte: sydneyMidnight(sydneyDay(now)) } } });
    if (today >= LIMITS.perLinkDay) return { error: "That's a lot of dockets today - call the office.", status: 429 };
    const { row } = await allocateNumber(
      async () => (await prisma.variationDocket.aggregate({ _max: { number: true } }))._max.number ?? 0,
      (number) => prisma.variationDocket.create({
        data: {
          number, jobId: job.id, projectId: job.projectId, day: job.day,
          projectName: job.projectName.slice(0, 200), jobNo: job.jobNo, address: job.address, client: job.client,
          ticks: JSON.stringify(p.ticks), otherText: p.otherText, note: p.note, photoIds: JSON.stringify(p.photoIds),
          customerName: p.customerName, customerPosition: p.customerPosition, lobosName: link.person.name.slice(0, 80), lobosPosition: p.lobosPosition,
          signedAt: now, replacesId, siteLinkId: link.id, linkKind: link.kind, resourceId: link.person.id,
          tasks: { create: p.tasks.map((t) => ({ n: t.n, description: t.description, men: t.men, start: t.start, finish: t.finish, hours: t.hours, hoursCalc: t.hoursCalc })) },
          items: { create: p.items.map((x) => ({ n: x.n, quantity: x.quantity, unit: x.unit, type: x.type, comment: x.comment })) },
          signatures: {
            create: [
              { role: "CUSTOMER", png: cust.png, bytes: cust.bytes, sha256: cust.sha256 },
              { role: "LOBOS", png: lobos.png, bytes: lobos.bytes, sha256: lobos.sha256 },
            ],
          },
        },
        select: { id: true },
      }),
    );
    return row;
  });
  if ("error" in made) return made;
  // The alert never holds up (or fails) the send.
  void alertSigned(made.id).catch((e) => console.error("variation alert", e instanceof Error ? e.message : "failed"));
  const [docket] = await linkDockets(link, now, [made.id]);
  return { docket };
}

// ---------- the phone alert (Ilies: Alex and me) ----------

// "Variation V-0012 signed - <project> (<supervisor>)" to every active COORDINATOR login and the owner - their own
// phones (the devices they turned alerts on for; none, nothing sent). Words only, no money. -> devices reached.
export async function alertSigned(docketId: string): Promise<number> {
  if (!variationsOn()) return 0;
  const d = await prisma.variationDocket.findUnique({ where: { id: docketId }, select: { id: true, number: true, projectName: true, lobosName: true } });
  if (!d) return 0;
  const msg = signedAlert({ id: d.id, number: d.number, projectName: d.projectName, supervisor: d.lobosName });
  if (!msg) return 0;
  const users = await prisma.user.findMany({ where: { active: true, OR: [{ role: "COORDINATOR" }, { email: OWNER_EMAIL }] }, select: { id: true, role: true, email: true, active: true } });
  const to = alertRecipients(users, OWNER_EMAIL);
  return to.length ? pushToUsers(to, msg, "normal") : 0;
}

// ---------- the office ----------

type Who = { id: string; name: string; role: string };
const OFFICE_ROW = {
  id: true, number: true, day: true, projectId: true, projectName: true, jobNo: true, client: true, ticks: true, lobosName: true,
  customerName: true, createdAt: true, replacesId: true, photoIds: true,
  tasks: { select: { hours: true } }, _count: { select: { items: true } },
} as const;

async function statusesOf(ids: string[]): Promise<Map<string, Status>> {
  const ev = ids.length ? await prisma.variationStatusEvent.findMany({ where: { docketId: { in: ids } }, select: { docketId: true, status: true, createdAt: true } }) : [];
  const by = new Map<string, { status: string; createdAt: Date }[]>();
  for (const e of ev) by.set(e.docketId, [...(by.get(e.docketId) ?? []), e]);
  return new Map(ids.map((id) => [id, currentStatus(by.get(id) ?? [])]));
}
async function replacedByOf(ids: string[]): Promise<Map<string, { id: string; number: string }>> {
  const rows = ids.length ? await prisma.variationDocket.findMany({ where: { replacesId: { in: ids } }, select: { id: true, number: true, replacesId: true }, orderBy: { number: "asc" } }) : [];
  const m = new Map<string, { id: string; number: string }>();
  for (const r of rows) m.set(r.replacesId!, { id: r.id, number: docketNo(r.number) }); // the newest correction wins
  return m;
}

type Row = { id: string; number: number; day: string; projectId: string | null; projectName: string; jobNo: string | null; client: string | null; ticks: string; lobosName: string; customerName: string; createdAt: Date; replacesId: string | null; photoIds: string; tasks: { hours: number | null }[]; _count: { items: number } };
function officeRow(r: Row, status: Status, repl: Map<string, string>, by: Map<string, { id: string; number: string }>): OfficeRowDTO {
  return {
    id: r.id, number: docketNo(r.number), day: r.day, projectId: r.projectId ?? "", project: r.projectName, jobNo: r.jobNo, client: r.client,
    ticks: jsonList(r.ticks), supervisor: r.lobosName, customerName: r.customerName, sentAt: r.createdAt.toISOString(),
    status, statusLabel: STATUS_LABEL[status], replaces: r.replacesId ? repl.get(r.replacesId) ?? null : null, replacedBy: by.get(r.id)?.number ?? null,
    tasks: r.tasks.length, items: r._count.items, photos: jsonList(r.photoIds).length, hours: totalHours(r.tasks),
  };
}

// /variations: newest first, filtered by project and by office status.
export async function officeList(f: { projectId?: string; status?: string }) {
  const rows = await prisma.variationDocket.findMany({ where: f.projectId ? { projectId: f.projectId } : {}, orderBy: { number: "desc" }, take: 500, select: OFFICE_ROW });
  const ids = rows.map((r) => r.id);
  const [st, repl, by, projects] = await Promise.all([
    statusesOf(ids), numbersOf(rows.map((r) => r.replacesId)), replacedByOf(ids),
    prisma.variationDocket.findMany({ where: { projectId: { not: null } }, distinct: ["projectId"], select: { projectId: true, projectName: true }, orderBy: { projectName: "asc" } }),
  ]);
  const list = rows.map((r) => officeRow(r, st.get(r.id) ?? "TO_PRICE", repl, by)).filter((r) => !f.status || r.status === f.status);
  return { rows: list, projects: projects.map((p) => ({ id: p.projectId!, label: p.projectName })), statuses: Object.entries(STATUS_LABEL).map(([key, label]) => ({ key, label })) };
}

// The coordinator's "Variations to price" card: how many, and the latest few.
export async function toPriceCard(latest = 5) {
  const all = await prisma.variationDocket.findMany({ orderBy: { number: "desc" }, take: 2000, select: { id: true } });
  const st = await statusesOf(all.map((r) => r.id));
  const toPrice = all.filter((r) => st.get(r.id) === "TO_PRICE").map((r) => r.id);
  const rows = toPrice.length ? await prisma.variationDocket.findMany({ where: { id: { in: toPrice.slice(0, latest) } }, orderBy: { number: "desc" }, select: OFFICE_ROW }) : [];
  const repl = await numbersOf(rows.map((r) => r.replacesId));
  return { count: toPrice.length, latest: rows.map((r) => officeRow(r, "TO_PRICE", repl, new Map())) };
}

// One docket, for the printable page.
export async function officeDetail(id: string, who: Who): Promise<OfficeDetailDTO | null> {
  if (typeof id !== "string" || !/^[a-z0-9]{10,40}$/.test(id)) return null;
  const d = await prisma.variationDocket.findUnique({
    where: { id },
    select: {
      ...OFFICE_ROW, jobId: true, address: true, otherText: true, note: true, customerPosition: true, lobosPosition: true, signedAt: true, linkKind: true,
      tasks: { select: { n: true, description: true, men: true, start: true, finish: true, hours: true, hoursCalc: true }, orderBy: { n: "asc" } },
      items: { select: { n: true, quantity: true, unit: true, type: true, comment: true }, orderBy: { n: "asc" } },
      signatures: { select: { role: true } },
    },
  });
  if (!d) return null;
  const [events, repl, by] = await Promise.all([
    prisma.variationStatusEvent.findMany({ where: { docketId: id }, orderBy: { createdAt: "asc" } }),
    numbersOf([d.replacesId]), replacedByOf([id]),
  ]);
  const status = currentStatus(events);
  return {
    ...officeRow(d, status, repl, by),
    jobId: d.jobId, address: d.address, otherText: d.otherText, note: d.note, customerPosition: d.customerPosition,
    lobosName: d.lobosName, lobosPosition: d.lobosPosition, signedAt: d.signedAt.toISOString(), linkKind: d.linkKind,
    replacesId: d.replacesId, replacedById: by.get(id)?.id ?? null,
    taskRows: d.tasks.map((t) => ({ ...t, edited: t.hours != null && t.hoursCalc != null && Math.abs(t.hours - t.hoursCalc) > 0.001 })),
    itemRows: d.items,
    photoIds: jsonList(d.photoIds),
    signatures: { customer: d.signatures.some((s) => s.role === "CUSTOMER"), lobos: d.signatures.some((s) => s.role === "LOBOS") },
    history: events.map((e) => ({ status: e.status, label: STATUS_LABEL[e.status as Status] ?? e.status, from: STATUS_LABEL[e.fromStatus as Status] ?? e.fromStatus, note: e.note, by: e.byName, at: e.createdAt.toISOString() })),
    canSetStatus: mayReadVariations(who.role),
  };
}

// The office status: a new event (never an edit), one at a time; the docket itself is never touched.
export async function setStatus(id: string, who: Who, body: Record<string, unknown>): Promise<{ status: Status } | Fail> {
  if (!mayReadVariations(who.role)) return { error: "You don't have permission to do that", status: 403 };
  if (typeof id !== "string" || !/^[a-z0-9]{10,40}$/.test(id)) return { error: "not found", status: 404 };
  return serial(async () => {
    const d = await prisma.variationDocket.findUnique({ where: { id }, select: { id: true } });
    if (!d) return { error: "not found", status: 404 };
    const events = await prisma.variationStatusEvent.findMany({ where: { docketId: id }, select: { status: true, createdAt: true } });
    const current = currentStatus(events);
    const c = statusChange(current, body);
    if ("error" in c) return { error: c.error, status: body.from !== undefined && body.from !== current ? 409 : 400 };
    await prisma.variationStatusEvent.create({ data: { docketId: id, status: c.to, fromStatus: current, note: c.note, byUserId: who.id, byName: who.name.slice(0, 80) } });
    return { status: c.to };
  });
}

// A signature image (CUSTOMER / LOBOS) - the office routes only.
export async function signaturePng(id: string, role: string): Promise<Buffer | null> {
  if (!/^[a-z0-9]{10,40}$/.test(id) || (role !== "CUSTOMER" && role !== "LOBOS")) return null;
  const s = await prisma.variationSignature.findUnique({ where: { docketId_role: { docketId: id, role } }, select: { png: true } });
  return s ? Buffer.from(s.png) : null;
}
// Is this media id one of the docket's photos?
export async function docketHasPhoto(id: string, mediaId: string): Promise<boolean> {
  if (!/^[a-z0-9]{10,40}$/.test(id) || !/^[a-z0-9]{10,40}$/.test(mediaId)) return false;
  const d = await prisma.variationDocket.findUnique({ where: { id }, select: { photoIds: true } });
  return !!d && jsonList(d.photoIds).includes(mediaId);
}
