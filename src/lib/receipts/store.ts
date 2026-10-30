// Receipts (R1 capture), server side: what a phone link can pick (today's jobs, Lobos trucks) and
// what's prefilled, photo uploads, sending a receipt, "My receipts", the odometer photo after a truck
// sign-in, and the office list. Rules: ./rules.ts. Design: docs/receipts/RECEIPTS-DESIGN.md.
// Nothing here touches jobs, sign-ins, allocations or costs; a link never gets a price back.
import { prisma } from "../prisma";
import { jobLabel, signinDates, sydneyTime } from "../signin";
import { fromSydneyLocal } from "../shiftTimes";
import type { ReceiptLink } from "../siteLinks";
import { saveReceiptPhoto } from "./files";
import { KIND_LABEL, LIMITS, PURPOSE_LABEL, STATUS_LABEL, parseReceipt, parseReimbursement, reimburseStatus, type Purpose, type ReceiptKind, type ReceiptLinkDTO } from "./rules";
import { MAX_TRIES, logOf, readOdometerSoon, readReceiptSoon } from "./runner";

type Problem = { error: string; status: number };
const since24h = () => new Date(Date.now() - 24 * 3_600_000);

// Sydney's midnight at the start of a day (default today), as an instant.
const sydneyMidnight = (day = signinDates().today) => fromSydneyLocal(`${day}T00:00`)!;
const nextDay = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

// ---------- what the phone can pick ----------

// Today's running jobs (and last night's night shift) - any of them can be picked for a tip docket.
function todaysJobs() {
  const { today, yesterday } = signinDates();
  return prisma.job.findMany({
    where: { status: "ACTIVE", OR: [{ date: new Date(today + "T00:00:00.000Z") }, { date: new Date(yesterday + "T00:00:00.000Z"), shift: "NIGHT" }] },
    select: { id: true, title: true, shift: true, projectId: true, project: { select: { name: true } }, assignments: { select: { resourceId: true, resource: { select: { type: true, ownership: true, category: true } } } } },
    orderBy: [{ date: "desc" }, { title: "asc" }],
  });
}

// Sites with no job running today that a tip docket can still be for - a driver picking up a bin left on a site
// between stages (Ilies, 30 Oct 2026). Projects not archived with a board day in the last 120 days or the next 30.
// The docket goes on the project with no job (jobId null): tip costs are by project, and an old day's docket
// count isn't changed.
async function otherSites(excludeProjectIds: Set<string | null>) {
  const day = (n: number) => new Date(new Date(signinDates().today + "T00:00:00.000Z").getTime() + n * 86_400_000);
  const rows = await prisma.project.findMany({
    where: { archived: false, jobs: { some: { date: { gte: day(-120), lte: day(30) } } } },
    select: { id: true, name: true, client: true },
    orderBy: { name: "asc" },
  });
  return rows.filter((p) => !excludeProjectIds.has(p.id));
}

// Lobos-owned trucks (the same ones that get a truck QR: not trailers, not hired).
export function lobosTrucks() {
  return prisma.resource.findMany({
    where: { type: "VEHICLE", ownership: "OWNED", active: true, NOT: { category: "Other" } },
    select: { id: true, name: true, identifier: true },
    orderBy: { name: "asc" },
  });
}
const isTruck = (r: { type: string; ownership: string; category: string | null }) => r.type === "VEHICLE" && r.ownership === "OWNED" && r.category !== "Other";

// Lobos-owned plant (excavators, loaders...) - fuel can be for a machine as well as a truck (Ilies, 27 Oct
// 2026). Attachments have no tank; hired plant isn't offered (Draft - until Ilies says so).
export function lobosPlant() {
  return prisma.resource.findMany({
    where: { type: "EQUIPMENT", ownership: "OWNED", active: true },
    select: { id: true, name: true, identifier: true },
    orderBy: { name: "asc" },
  });
}
// Everything fuel can be for, grouped for the picker and the indicators.
export async function fuelAssets(): Promise<{ id: string; name: string; label: string; group: "TRUCK" | "PLANT" }[]> {
  const [trucks, plant] = await Promise.all([lobosTrucks(), lobosPlant()]);
  const label = (t: { name: string; identifier: string | null }) => (t.identifier ? `${t.name} (${t.identifier})` : t.name);
  return [...trucks.map((t) => ({ id: t.id, name: t.name, label: label(t), group: "TRUCK" as const })), ...plant.map((p) => ({ id: p.id, name: p.name, label: label(p), group: "PLANT" as const }))];
}

export type ReceiptOptionsDTO = {
  jobs: { id: string; label: string; mine: boolean }[];
  sites: { id: string; label: string }[]; // projects not running today - a bin picked up from a site between stages
  trucks: { id: string; label: string }[];
  plant: { id: string; label: string }[]; // owned machines - fuel can be for them too
  prefill: { jobId: string | null; vehicleId: string | null };
};

// Their job today: on the board, else where they signed in today. Their truck today: the truck QR
// they signed in on today, else the one Lobos truck on their job's board (if there's exactly one).
export async function receiptOptions(link: ReceiptLink): Promise<ReceiptOptionsDTO> {
  const me = link.person.id;
  const [jobs, trucks, plant, signIns] = await Promise.all([
    todaysJobs(),
    lobosTrucks(),
    lobosPlant(),
    prisma.siteAttendance.findMany({
      where: { resourceId: me, signInAt: { gte: since24h() }, status: { not: "REJECTED" } },
      select: { jobId: true, place: true, vehicleId: true },
      orderBy: { signInAt: "desc" },
    }),
  ]);
  const mine = jobs.filter((j) => j.assignments.some((a) => a.resourceId === me));
  const signedJob = signIns.find((s) => s.jobId && jobs.some((j) => j.id === s.jobId))?.jobId ?? null;
  const jobId = mine[0]?.id ?? signedJob;
  const signedTruck = signIns.find((s) => s.place === "VEHICLE" && s.vehicleId && trucks.some((t) => t.id === s.vehicleId))?.vehicleId ?? null;
  const boardTrucks = [...new Set(mine.flatMap((j) => j.assignments.filter((a) => isTruck(a.resource)).map((a) => a.resourceId)))];
  const vehicleId = signedTruck ?? (boardTrucks.length === 1 ? boardTrucks[0] : null);
  const mineIds = new Set([...mine.map((j) => j.id), ...(signedJob ? [signedJob] : [])]);
  const sites = await otherSites(new Set(jobs.map((j) => j.projectId)));
  return {
    jobs: [...jobs].sort((a, b) => Number(mineIds.has(b.id)) - Number(mineIds.has(a.id))).map((j) => ({ id: j.id, label: jobLabel(j), mine: mineIds.has(j.id) })),
    sites: sites.map((p) => ({ id: p.id, label: p.name })),
    trucks: trucks.map((t) => ({ id: t.id, label: t.identifier ? `${t.name} (${t.identifier})` : t.name })),
    plant: plant.map((p) => ({ id: p.id, label: p.identifier ? `${p.name} (${p.identifier})` : p.name })),
    prefill: { jobId, vehicleId },
  };
}

// ---------- photos ----------

export async function uploadReceiptPhoto(link: { id: string; person: { name: string } }, dataUrl: unknown): Promise<{ id: string } | Problem> {
  const sent = await prisma.receiptPhoto.count({ where: { siteLinkId: link.id, createdAt: { gte: since24h() } } });
  if (sent >= LIMITS.photosPerLinkPerDay) return { error: "That's the most photos this link can send in a day - call the office.", status: 429 };
  const saved = await saveReceiptPhoto(dataUrl);
  if ("error" in saved) return { error: saved.error, status: 400 };
  const p = await prisma.receiptPhoto.create({ data: { fileName: saved.fileName, siteLinkId: link.id, takenBy: link.person.name } });
  return { id: p.id };
}

// ---------- sending a receipt ----------

export async function createReceipt(link: ReceiptLink, body: Record<string, unknown>): Promise<{ receipt: ReceiptLinkDTO; message: string } | Problem> {
  const input = parseReceipt(body);
  if ("error" in input) return { error: input.error, status: 400 };
  const today = await prisma.receipt.count({ where: { siteLinkId: link.id, sentAt: { gte: since24h() } } });
  if (today >= LIMITS.receiptsPerLinkPerDay) return { error: "That's the most receipts this link can send in a day - call the office.", status: 429 };
  // Only photos this link uploaded in the last day and not already on a receipt.
  const photos = await prisma.receiptPhoto.findMany({ where: { id: { in: input.photoIds }, siteLinkId: link.id, receiptId: null, odometerReadingId: null, createdAt: { gte: since24h() } }, select: { id: true } });
  if (photos.length !== input.photoIds.length) return { error: "A photo didn't upload - take it again.", status: 400 };
  let projectId: string | null = null;
  if (input.kind === "TIP" && input.projectId) {
    const jobs = await todaysJobs();
    const site = (await otherSites(new Set(jobs.map((j) => j.projectId)))).find((p) => p.id === input.projectId);
    if (!site) return { error: "Pick the site from the list - call the office if it isn't there.", status: 400 };
    projectId = site.id;
  } else if (input.kind === "TIP") {
    const job = (await todaysJobs()).find((j) => j.id === input.jobId);
    if (!job) return { error: "That job isn't running today - pick today's job.", status: 400 };
    projectId = job.projectId;
  } else if (!(await fuelAssets()).some((t) => t.id === input.vehicleId)) {
    return { error: "Pick one of the Lobos trucks or machines.", status: 400 };
  }
  const r = await prisma.receipt.create({
    data: {
      kind: input.kind, siteLinkId: link.id, sentBy: link.person.name, sentByResourceId: link.person.id,
      jobId: input.jobId, projectId, vehicleId: input.vehicleId, asbestos: input.asbestos,
      photos: { connect: photos.map((p) => ({ id: p.id })) },
    },
  });
  readReceiptSoon(r.id); // Claude reads it in the background (R2)
  const [dto] = await linkRows([r.id]);
  return { receipt: dto, message: `${KIND_LABEL[input.kind]} sent - thanks. It'll be read for you.` };
}

// ---------- "My receipts" (what this person sent today - from any of their links) ----------

async function linkRows(ids?: string[], personId?: string): Promise<ReceiptLinkDTO[]> {
  const rows = await prisma.receipt.findMany({
    where: ids ? { id: { in: ids } } : { sentByResourceId: personId, sentAt: { gte: sydneyMidnight() } },
    select: { id: true, kind: true, jobId: true, projectId: true, vehicleId: true, asbestos: true, status: true, sentAt: true, _count: { select: { photos: true } } },
    orderBy: { sentAt: "desc" },
  });
  const [jobs, projects, trucks] = await Promise.all([
    prisma.job.findMany({ where: { id: { in: rows.map((r) => r.jobId).filter((x): x is string => !!x) } }, select: { id: true, title: true, shift: true, project: { select: { name: true } } } }),
    prisma.project.findMany({ where: { id: { in: rows.filter((r) => !r.jobId).map((r) => r.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.resource.findMany({ where: { id: { in: rows.map((r) => r.vehicleId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const tipFor = (r: { jobId: string | null; projectId: string | null }) => {
    const j = jobs.find((x) => x.id === r.jobId);
    return j ? jobLabel(j) : projects.find((p) => p.id === r.projectId)?.name ?? "a job";
  };
  return rows.filter((r) => r.kind !== "PURCHASE").map((r) => ({
    id: r.id, kind: r.kind as ReceiptKind, label: KIND_LABEL[r.kind as ReceiptKind] ?? r.kind,
    for: r.kind === "TIP" ? tipFor(r) : trucks.find((t) => t.id === r.vehicleId)?.name ?? "a truck",
    at: sydneyTime(r.sentAt) ?? "", asbestos: r.asbestos, photos: r._count.photos, status: STATUS_LABEL[r.status] ?? "Sent",
  }));
}
export const myReceiptsToday = (link: ReceiptLink) => linkRows(undefined, link.person.id);
export const receiptsSentToday = (personId: string) => prisma.receipt.count({ where: { sentByResourceId: personId, sentAt: { gte: sydneyMidnight() } } });

// For the daily log: dockets sent today (by anyone) for each job.
export async function docketsSentFor(jobIds: string[]): Promise<Map<string, number>> {
  if (!jobIds.length) return new Map();
  const g = await prisma.receipt.groupBy({ by: ["jobId"], where: { kind: "TIP", jobId: { in: jobIds }, status: { not: "REJECTED" } }, _count: { _all: true } });
  return new Map(g.map((x) => [x.jobId as string, x._count._all]));
}

// ---------- the odometer photo after a truck sign-in ----------

// One reading per truck sign-in: a photo (a retake replaces it), or "Can't now".
export async function odometerFor(attendanceId: string, body: Record<string, unknown>): Promise<{ id: string; message: string } | Problem> {
  const a = await prisma.siteAttendance.findUnique({ where: { id: attendanceId }, select: { id: true, place: true, vehicleId: true, resourceId: true, workerName: true, signInAt: true } });
  if (!a || a.place !== "VEHICLE" || !a.vehicleId) return { error: "That sign-in isn't on a truck.", status: 400 };
  const poster = await prisma.siteLink.findFirst({ where: { kind: "POSTER", place: "VEHICLE", resourceId: a.vehicleId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const linkId = poster?.id ?? `vehicle:${a.vehicleId}`;
  const existing = await prisma.odometerReading.findUnique({ where: { siteAttendanceId: a.id }, include: { photos: { select: { id: true } } } });
  if (body.skip === true) {
    if (existing) return { id: existing.id, message: existing.status === "SKIPPED" ? "No problem." : "Already sent - thanks." };
    const r = await prisma.odometerReading.create({ data: { vehicleId: a.vehicleId, siteAttendanceId: a.id, siteLinkId: linkId, sentBy: a.workerName, sentByResourceId: a.resourceId, status: "SKIPPED" } });
    return { id: r.id, message: "No problem - next time." };
  }
  const up = await uploadReceiptPhoto({ id: linkId, person: { name: a.workerName } }, body.dataUrl);
  if ("error" in up) return up;
  if (existing) {
    await prisma.receiptPhoto.updateMany({ where: { odometerReadingId: existing.id }, data: { odometerReadingId: null } });
    await prisma.receiptPhoto.update({ where: { id: up.id }, data: { odometerReadingId: existing.id } });
    await prisma.odometerReading.update({ where: { id: existing.id }, data: { status: "SENT", sentAt: new Date(), km: null, reading: null } });
    readOdometerSoon(existing.id);
    return { id: up.id, message: "Odometer photo replaced - thanks." };
  }
  const created = await prisma.odometerReading.create({
    data: { vehicleId: a.vehicleId, siteAttendanceId: a.id, siteLinkId: linkId, sentBy: a.workerName, sentByResourceId: a.resourceId, photos: { connect: [{ id: up.id }] } },
  });
  readOdometerSoon(created.id);
  return { id: up.id, message: "Odometer photo sent - thanks." };
}

// ---------- the office list (/receipts, Manager+) ----------

// What was read (R2) - office-side only, never on a link (it has prices).
export type ReadFieldsDTO = {
  docketNo?: string | null; docketAt?: string | null; tipSite?: string | null; wasteType?: string | null; tonnes?: number | null;
  priceExGst?: number | null; priceIncGst?: number | null; litres?: number | null; pricePerLitre?: number | null; fuelTotal?: number | null;
  station?: string | null; rego?: string | null; km?: number | null;
};
export type ReceiptOfficeDTO = {
  id: string; type: "TIP" | "FUEL" | "ODOMETER"; label: string; for: string; jobId: string | null; vehicleId: string | null;
  sentBy: string; sentAt: string; asbestos: boolean | null; status: string; photoIds: string[];
  read: ReadFieldsDTO; reasons: string[]; unreadable: boolean; corrections: { at: string; by: string; field: string }[];
  rejected: { by: string; reason: string } | null;
  onInvoice: boolean; // a tip invoice has replaced this docket's estimate (R3)
  added?: { by: string; fromReceiptId: string } | null; // typed in by the office from another receipt's photo
};
export type ReceiptFilters = { day?: string; jobId?: string; vehicleId?: string; person?: string; kind?: string; asbestos?: string; check?: string };

const reasonsOf = (s: string | null) => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function officeList(f: ReceiptFilters): Promise<{ rows: ReceiptOfficeDTO[]; jobs: { id: string; label: string }[]; trucks: { id: string; label: string }[]; people: string[]; toCheck: number }> {
  const day = f.day && /^\d{4}-\d{2}-\d{2}$/.test(f.day) ? f.day : null;
  const check = f.check === "1";
  // One Sydney day, or the last 30 days ("Check these": everything still to check from the last 90 days).
  const from = day ? sydneyMidnight(day) : new Date(Date.now() - (check ? 90 : 30) * 86_400_000);
  const to = day ? sydneyMidnight(nextDay(day)) : new Date(Date.now() + 60_000);
  const wantOdo = !f.kind || f.kind === "ODOMETER";
  const wantReceipts = !f.kind || f.kind === "TIP" || f.kind === "FUEL";
  // Own-money purchases (PURCHASE) belong to accounts' Reimbursements - never on this list.
  const statusWhere = check ? { status: { in: ["CHECK", "SENT"] } } : {};
  const [receipts, readings] = await Promise.all([
    wantReceipts
      ? prisma.receipt.findMany({
          where: {
            sentAt: { gte: from, lt: to }, ...statusWhere,
            kind: f.kind === "TIP" || f.kind === "FUEL" ? f.kind : { in: ["TIP", "FUEL"] },
            ...(f.jobId ? { jobId: f.jobId } : {}),
            ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
            ...(f.person ? { sentBy: f.person } : {}),
            ...(f.asbestos === "yes" ? { asbestos: true } : f.asbestos === "no" ? { asbestos: false } : {}),
          },
          include: { photos: { select: { id: true }, orderBy: { createdAt: "asc" } } },
          orderBy: { sentAt: "desc" }, take: 500,
        })
      : [],
    wantOdo && !f.jobId && !f.asbestos
      ? prisma.odometerReading.findMany({
          where: { sentAt: { gte: from, lt: to }, ...statusWhere, ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}), ...(f.person ? { sentBy: f.person } : {}) },
          include: { photos: { select: { id: true } } },
          orderBy: { sentAt: "desc" }, take: 500,
        })
      : [],
  ]);
  const jobIds = [...new Set(receipts.map((r) => r.jobId).filter((x): x is string => !!x))];
  // A docket added from another receipt's photo shows that receipt's photo(s).
  const sharedFrom = [...new Set(receipts.map((r) => r.photoFromReceiptId).filter((x): x is string => !!x))];
  const sharedPhotos = new Map<string, string[]>();
  for (const p of sharedFrom.length ? await prisma.receiptPhoto.findMany({ where: { receiptId: { in: sharedFrom } }, select: { id: true, receiptId: true }, orderBy: { createdAt: "asc" } }) : []) {
    sharedPhotos.set(p.receiptId!, [...(sharedPhotos.get(p.receiptId!) ?? []), p.id]);
  }
  const recent = { sentAt: { gte: new Date(Date.now() - 60 * 86_400_000) } };
  const siteIds = [...new Set(receipts.filter((r) => !r.jobId).map((r) => r.projectId).filter((x): x is string => !!x))];
  const [jobRows, siteRows, trucks, senders, odoSenders, toCheck] = await Promise.all([
    prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true, shift: true, date: true, project: { select: { name: true } } } }),
    prisma.project.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }),
    fuelAssets(),
    prisma.receipt.findMany({ where: recent, select: { sentBy: true }, distinct: ["sentBy"] }),
    prisma.odometerReading.findMany({ where: recent, select: { sentBy: true }, distinct: ["sentBy"] }),
    countToCheck(),
  ]);
  const extra = (status: string, reading: string | null, reasons: string[]) => {
    const log = logOf(reading);
    const unreadable = status === "SENT" && (log.tries ?? 0) >= MAX_TRIES;
    return {
      reasons: unreadable ? ["Couldn't be read - type it in, or read it again"] : reasons,
      unreadable,
      corrections: (log.corrections ?? []).map((c) => ({ at: c.at, by: c.by, field: c.field })),
      rejected: log.rejected ? { by: log.rejected.by, reason: log.rejected.reason } : null,
    };
  };
  const jobName = (id: string | null, projectId?: string | null) => {
    const j = jobRows.find((x) => x.id === id);
    if (j) return `${jobLabel(j)} · ${j.date.toISOString().slice(5, 10).split("-").reverse().join("/")}`;
    const site = !id && siteRows.find((p) => p.id === projectId); // a docket from a site not running that day
    return site ? `${site.name} · not on that day` : "a job";
  };
  const truckName = (id: string | null) => trucks.find((t) => t.id === id)?.name ?? "a truck";
  const rows: ReceiptOfficeDTO[] = [
    ...receipts.map((r) => ({
      id: r.id, type: r.kind as "TIP" | "FUEL", label: KIND_LABEL[r.kind as ReceiptKind] ?? r.kind, for: r.kind === "TIP" ? jobName(r.jobId, r.projectId) : truckName(r.vehicleId),
      jobId: r.jobId, vehicleId: r.vehicleId, sentBy: r.sentBy, sentAt: r.sentAt.toISOString(), asbestos: r.asbestos, status: r.status,
      photoIds: r.photoFromReceiptId ? sharedPhotos.get(r.photoFromReceiptId) ?? [] : r.photos.map((p) => p.id),
      added: logOf(r.reading).added ? { by: logOf(r.reading).added!.by, fromReceiptId: logOf(r.reading).added!.fromReceiptId } : null,
      read: r.kind === "TIP"
        ? { docketNo: r.docketNo, docketAt: iso(r.docketAt), tipSite: r.tipSite, wasteType: r.wasteType, tonnes: r.tonnes, priceExGst: r.priceExGst, priceIncGst: r.priceIncGst, rego: r.rego }
        : { litres: r.litres, pricePerLitre: r.pricePerLitre, fuelTotal: r.fuelTotal, station: r.station, docketAt: iso(r.docketAt), rego: r.rego },
      ...extra(r.status, r.reading, reasonsOf(r.checkReasons)), onInvoice: !!r.invoicedCostId,
    })),
    ...readings.map((r) => ({
      id: r.id, type: "ODOMETER" as const, label: "Odometer", for: truckName(r.vehicleId), jobId: null, vehicleId: r.vehicleId,
      sentBy: r.sentBy, sentAt: r.sentAt.toISOString(), asbestos: null, status: r.status, photoIds: r.photos.map((p) => p.id),
      read: { km: r.km }, ...extra(r.status, r.reading, logOf(r.reading).reasons ?? []), onInvoice: false,
    })),
  ]
    // "Check these": what a person must look at - to check, or couldn't be read after three tries.
    .filter((r) => !check || r.status === "CHECK" || r.unreadable)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return {
    rows,
    jobs: jobRows.map((j) => ({ id: j.id, label: jobName(j.id) })).sort((a, b) => a.label.localeCompare(b.label)),
    trucks: trucks.map((t) => ({ id: t.id, label: t.name })),
    people: [...new Set([...senders, ...odoSenders].map((p) => p.sentBy))].sort(),
    toCheck,
  };
}

// How many are waiting for a person (to check, or unreadable) - the tab's count.
export async function countToCheck(): Promise<number> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [checks, odoChecks, sent, odoSent] = await Promise.all([
    prisma.receipt.count({ where: { status: "CHECK", kind: { not: "PURCHASE" }, sentAt: { gte: since } } }),
    prisma.odometerReading.count({ where: { status: "CHECK", sentAt: { gte: since } } }),
    prisma.receipt.findMany({ where: { status: "SENT", kind: { not: "PURCHASE" }, sentAt: { gte: since } }, select: { reading: true } }),
    prisma.odometerReading.findMany({ where: { status: "SENT", sentAt: { gte: since } }, select: { reading: true } }),
  ]);
  return checks + odoChecks + [...sent, ...odoSent].filter((r) => (logOf(r.reading).tries ?? 0) >= MAX_TRIES).length;
}

// ---------- reimbursements from the phone (docs/accounts/REIMBURSE-LINK-DESIGN.md) ----------

export type ReimburseLinkDTO = { id: string; purpose: string; for: string | null; sentOn: string; status: string };

// "My reimbursements": what this person sent "I paid this myself" for in the last 60 days, with where it's at.
// Words and dates only - never an amount.
export async function myReimbursements(link: ReceiptLink): Promise<ReimburseLinkDTO[]> {
  const rows = await prisma.receipt.findMany({
    where: { ownMoney: true, sentByResourceId: link.person.id, sentAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
    select: { id: true, purpose: true, note: true, vehicleId: true, status: true, sentAt: true },
    orderBy: { sentAt: "desc" }, take: 60,
  });
  const [claims, assets] = await Promise.all([
    prisma.reimbursement.findMany({ where: { receiptId: { in: rows.map((r) => r.id) } }, select: { receiptId: true, status: true, paidOn: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.resource.findMany({ where: { id: { in: rows.map((r) => r.vehicleId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => {
    const mine = claims.filter((c) => c.receiptId === r.id);
    const claim = mine.find((c) => c.status !== "CANCELLED") ?? mine[mine.length - 1] ?? null;
    return {
      id: r.id, purpose: PURPOSE_LABEL[r.purpose as Purpose] ?? "Other",
      for: r.purpose === "FUEL" ? assets.find((a) => a.id === r.vehicleId)?.name ?? null : r.note,
      sentOn: r.sentAt.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" }),
      status: reimburseStatus(r.status, claim ? { status: claim.status, paidOn: claim.paidOn } : null),
    };
  });
}

// "I paid this myself" from a supervisor's or driver's link: fuel stays a FUEL receipt (it counts in the
// fuel indicators - one photo, not two), anything else is a PURCHASE. Read in the background like any
// receipt; a clean reading becomes the claim (reimbursements/store claimFromOwnReceipt).
export async function createReimbursementReceipt(link: ReceiptLink, body: Record<string, unknown>): Promise<{ message: string } | Problem> {
  const input = parseReimbursement(body);
  if ("error" in input) return { error: input.error, status: 400 };
  const today = await prisma.receipt.count({ where: { siteLinkId: link.id, sentAt: { gte: since24h() } } });
  if (today >= LIMITS.receiptsPerLinkPerDay) return { error: "That's the most receipts this link can send in a day - call the office.", status: 429 };
  const photos = await prisma.receiptPhoto.findMany({ where: { id: { in: input.photoIds }, siteLinkId: link.id, receiptId: null, odometerReadingId: null, createdAt: { gte: since24h() } }, select: { id: true } });
  if (photos.length !== input.photoIds.length) return { error: "A photo didn't upload - take it again.", status: 400 };
  if (input.purpose === "FUEL" && !(await fuelAssets()).some((a) => a.id === input.vehicleId)) return { error: "Pick one of the Lobos trucks or machines.", status: 400 };
  const r = await prisma.receipt.create({
    data: {
      kind: input.purpose === "FUEL" ? "FUEL" : "PURCHASE", siteLinkId: link.id, sentBy: link.person.name, sentByResourceId: link.person.id,
      vehicleId: input.vehicleId, ownMoney: true, purpose: input.purpose, note: input.note,
      photos: { connect: photos.map((p) => ({ id: p.id })) },
    },
  });
  readReceiptSoon(r.id);
  return { message: "Sent to accounts - they'll pay you back. You'll see here when it's paid." };
}
