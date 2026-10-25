// Receipts (R1 capture), server side: what a phone link can pick (today's jobs, Lobos trucks) and
// what's prefilled, photo uploads, sending a receipt, "My receipts", the odometer photo after a truck
// sign-in, and the office list. Rules: ./rules.ts. Design: docs/receipts/RECEIPTS-DESIGN.md.
// Nothing here touches jobs, sign-ins, allocations or costs; a link never gets a price back.
import { prisma } from "../prisma";
import { jobLabel, signinDates, sydneyTime } from "../signin";
import { fromSydneyLocal } from "../shiftTimes";
import type { ReceiptLink } from "../siteLinks";
import { saveReceiptPhoto } from "./files";
import { KIND_LABEL, LIMITS, STATUS_LABEL, parseReceipt, type ReceiptKind, type ReceiptLinkDTO } from "./rules";

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

// Lobos-owned trucks (the same ones that get a truck QR: not trailers, not hired).
export function lobosTrucks() {
  return prisma.resource.findMany({
    where: { type: "VEHICLE", ownership: "OWNED", active: true, NOT: { category: "Other" } },
    select: { id: true, name: true, identifier: true },
    orderBy: { name: "asc" },
  });
}
const isTruck = (r: { type: string; ownership: string; category: string | null }) => r.type === "VEHICLE" && r.ownership === "OWNED" && r.category !== "Other";

export type ReceiptOptionsDTO = {
  jobs: { id: string; label: string; mine: boolean }[];
  trucks: { id: string; label: string }[];
  prefill: { jobId: string | null; vehicleId: string | null };
};

// Their job today: on the board, else where they signed in today. Their truck today: the truck QR
// they signed in on today, else the one Lobos truck on their job's board (if there's exactly one).
export async function receiptOptions(link: ReceiptLink): Promise<ReceiptOptionsDTO> {
  const me = link.person.id;
  const [jobs, trucks, signIns] = await Promise.all([
    todaysJobs(),
    lobosTrucks(),
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
  return {
    jobs: [...jobs].sort((a, b) => Number(mineIds.has(b.id)) - Number(mineIds.has(a.id))).map((j) => ({ id: j.id, label: jobLabel(j), mine: mineIds.has(j.id) })),
    trucks: trucks.map((t) => ({ id: t.id, label: t.identifier ? `${t.name} (${t.identifier})` : t.name })),
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
  if (input.kind === "TIP") {
    const job = (await todaysJobs()).find((j) => j.id === input.jobId);
    if (!job) return { error: "That job isn't running today - pick today's job.", status: 400 };
    projectId = job.projectId;
  } else if (!(await lobosTrucks()).some((t) => t.id === input.vehicleId)) {
    return { error: "Pick one of the Lobos trucks.", status: 400 };
  }
  const r = await prisma.receipt.create({
    data: {
      kind: input.kind, siteLinkId: link.id, sentBy: link.person.name, sentByResourceId: link.person.id,
      jobId: input.jobId, projectId, vehicleId: input.vehicleId, asbestos: input.asbestos,
      photos: { connect: photos.map((p) => ({ id: p.id })) },
    },
  });
  const [dto] = await linkRows([r.id]);
  return { receipt: dto, message: `${KIND_LABEL[input.kind]} sent - thanks. It'll be read for you.` };
}

// ---------- "My receipts" (what this link sent today) ----------

async function linkRows(ids?: string[], linkId?: string): Promise<ReceiptLinkDTO[]> {
  const rows = await prisma.receipt.findMany({
    where: ids ? { id: { in: ids } } : { siteLinkId: linkId, sentAt: { gte: sydneyMidnight() } },
    select: { id: true, kind: true, jobId: true, vehicleId: true, asbestos: true, status: true, sentAt: true, _count: { select: { photos: true } } },
    orderBy: { sentAt: "desc" },
  });
  const [jobs, trucks] = await Promise.all([
    prisma.job.findMany({ where: { id: { in: rows.map((r) => r.jobId).filter((x): x is string => !!x) } }, select: { id: true, title: true, shift: true, project: { select: { name: true } } } }),
    prisma.resource.findMany({ where: { id: { in: rows.map((r) => r.vehicleId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind as ReceiptKind, label: KIND_LABEL[r.kind as ReceiptKind] ?? r.kind,
    for: r.kind === "TIP" ? (() => { const j = jobs.find((x) => x.id === r.jobId); return j ? jobLabel(j) : "a job"; })() : trucks.find((t) => t.id === r.vehicleId)?.name ?? "a truck",
    at: sydneyTime(r.sentAt) ?? "", asbestos: r.asbestos, photos: r._count.photos, status: STATUS_LABEL[r.status] ?? "Sent",
  }));
}
export const myReceiptsToday = (link: ReceiptLink) => linkRows(undefined, link.id);
export const receiptsSentToday = (linkId: string) => prisma.receipt.count({ where: { siteLinkId: linkId, sentAt: { gte: sydneyMidnight() } } });

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
    await prisma.odometerReading.update({ where: { id: existing.id }, data: { status: "SENT", sentAt: new Date() } });
    return { id: up.id, message: "Odometer photo replaced - thanks." };
  }
  await prisma.odometerReading.create({
    data: { vehicleId: a.vehicleId, siteAttendanceId: a.id, siteLinkId: linkId, sentBy: a.workerName, sentByResourceId: a.resourceId, photos: { connect: [{ id: up.id }] } },
  });
  return { id: up.id, message: "Odometer photo sent - thanks." };
}

// ---------- the office list (/receipts, Manager+) ----------

export type ReceiptOfficeDTO = {
  id: string; type: "TIP" | "FUEL" | "ODOMETER"; label: string; for: string; jobId: string | null; vehicleId: string | null;
  sentBy: string; sentAt: string; asbestos: boolean | null; status: string; photoIds: string[];
};
export type ReceiptFilters = { day?: string; jobId?: string; vehicleId?: string; person?: string; kind?: string; asbestos?: string };

export async function officeList(f: ReceiptFilters): Promise<{ rows: ReceiptOfficeDTO[]; jobs: { id: string; label: string }[]; trucks: { id: string; label: string }[]; people: string[] }> {
  const day = f.day && /^\d{4}-\d{2}-\d{2}$/.test(f.day) ? f.day : null;
  // One Sydney day, or the last 30 days.
  const from = day ? sydneyMidnight(day) : new Date(Date.now() - 30 * 86_400_000);
  const to = day ? sydneyMidnight(nextDay(day)) : new Date(Date.now() + 60_000);
  const wantOdo = !f.kind || f.kind === "ODOMETER";
  const wantReceipts = !f.kind || f.kind === "TIP" || f.kind === "FUEL";
  const [receipts, readings] = await Promise.all([
    wantReceipts && !(f.asbestos && f.kind === "ODOMETER")
      ? prisma.receipt.findMany({
          where: {
            sentAt: { gte: from, lt: to },
            ...(f.kind === "TIP" || f.kind === "FUEL" ? { kind: f.kind } : {}),
            ...(f.jobId ? { jobId: f.jobId } : {}),
            ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
            ...(f.person ? { sentBy: f.person } : {}),
            ...(f.asbestos === "yes" ? { asbestos: true } : f.asbestos === "no" ? { asbestos: false } : {}),
          },
          select: { id: true, kind: true, jobId: true, vehicleId: true, sentBy: true, sentAt: true, asbestos: true, status: true, photos: { select: { id: true }, orderBy: { createdAt: "asc" } } },
          orderBy: { sentAt: "desc" }, take: 500,
        })
      : [],
    wantOdo && !f.jobId && !f.asbestos
      ? prisma.odometerReading.findMany({
          where: { sentAt: { gte: from, lt: to }, ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}), ...(f.person ? { sentBy: f.person } : {}) },
          select: { id: true, vehicleId: true, sentBy: true, sentAt: true, status: true, photos: { select: { id: true } } },
          orderBy: { sentAt: "desc" }, take: 500,
        })
      : [],
  ]);
  const jobIds = [...new Set(receipts.map((r) => r.jobId).filter((x): x is string => !!x))];
  const [jobRows, trucks, people] = await Promise.all([
    prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true, shift: true, date: true, project: { select: { name: true } } } }),
    lobosTrucks(),
    prisma.receipt.findMany({ where: { sentAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, select: { sentBy: true }, distinct: ["sentBy"] }),
  ]);
  const jobName = (id: string | null) => { const j = jobRows.find((x) => x.id === id); return j ? `${jobLabel(j)} · ${j.date.toISOString().slice(5, 10).split("-").reverse().join("/")}` : "a job"; };
  const truckName = (id: string | null) => trucks.find((t) => t.id === id)?.name ?? "a truck";
  const rows: ReceiptOfficeDTO[] = [
    ...receipts.map((r) => ({
      id: r.id, type: r.kind as "TIP" | "FUEL", label: KIND_LABEL[r.kind as ReceiptKind] ?? r.kind, for: r.kind === "TIP" ? jobName(r.jobId) : truckName(r.vehicleId),
      jobId: r.jobId, vehicleId: r.vehicleId, sentBy: r.sentBy, sentAt: r.sentAt.toISOString(), asbestos: r.asbestos, status: r.status, photoIds: r.photos.map((p) => p.id),
    })),
    ...readings.map((r) => ({
      id: r.id, type: "ODOMETER" as const, label: "Odometer", for: truckName(r.vehicleId), jobId: null, vehicleId: r.vehicleId,
      sentBy: r.sentBy, sentAt: r.sentAt.toISOString(), asbestos: null, status: r.status, photoIds: r.photos.map((p) => p.id),
    })),
  ].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return {
    rows,
    jobs: jobRows.map((j) => ({ id: j.id, label: jobName(j.id) })).sort((a, b) => a.label.localeCompare(b.label)),
    trucks: trucks.map((t) => ({ id: t.id, label: t.name })),
    people: people.map((p) => p.sentBy).sort(),
  };
}
