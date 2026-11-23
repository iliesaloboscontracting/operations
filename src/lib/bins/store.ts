// Bins (Ilies, 23 Nov 2026), server side: what a SUPERVISOR / DRIVER link can pick and sends (delivered, picked up,
// photos), the office page (bins out, history, register, tip docket suggestions), the dashboard card, and the office's
// writes (register, corrections, cancel, put back on site, tip docket confirm / reject). Rules: ./rules.ts.
// Nothing here touches jobs, sign-ins, allocations, costs or tip cost maths (lib/receipts/tipCosts.ts); no row is ever
// deleted; a link never gets a price back; every office change is in RecordChange with its reason.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { linkLabel } from "../dailyLog/money";
import { signinDates } from "../signin";
import { fromSydneyLocal } from "../shiftTimes";
import { saveReceiptPhoto } from "../receipts/files";
import { recordChanges, writeChanges, writeLock, type Who } from "../history/store";
import type { BinLink } from "../siteLinks";
import { pushToUsers } from "../push";
import {
  BIN_CONTENTS, BIN_SIZES, BIN_USES, CONFIRM_WINDOW, binAlertsOn, clientBinAlert, clientBinCounts, LIMITS, STATUS_LABEL, binLabel, canMove, chooseBin, contentsLabel, dayText, daysOut, daysText,
  defaultLabel, inWindow, isBinSize, overFleet, parseCorrection, parseDelivery, parsePickup, rejectedOf, sizeLabel, tidy, tipCandidates, useLabel,
  type BinLinkOptionsDTO, type BinLinkRowDTO, type BinStatus, type FleetWarning,
} from "./rules";

type Problem = { error: string; status: number };
export class BinError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const since24h = () => new Date(Date.now() - 24 * 3_600_000);
const sydneyMidnight = () => fromSydneyLocal(`${signinDates().today}T00:00`)!;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const byName = (w: Who) => (w?.name && w.name.trim()) || "Operations";

// ---------- the link (SUPERVISOR / DRIVER) ----------

// Active projects only, like the other site-link pickers - the person's jobs today (and last night's night shift) first.
async function linkProjects(personId: string) {
  const { today, yesterday } = signinDates();
  const [projects, mine] = await Promise.all([
    prisma.project.findMany({ where: { status: "ACTIVE", archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.job.findMany({
      where: { cancelledAt: null, assignments: { some: { resourceId: personId } }, OR: [{ date: new Date(today + "T00:00:00.000Z") }, { date: new Date(yesterday + "T00:00:00.000Z"), shift: "NIGHT" }] },
      select: { projectId: true },
    }),
  ]);
  const mineIds = new Set(mine.map((j) => j.projectId));
  return projects
    .map((p) => ({ id: p.id, label: linkLabel(p.name, "Unnamed site"), mine: mineIds.has(p.id) }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.label.localeCompare(b.label));
}

const activeBins = () => prisma.bin.findMany({ where: { retiredAt: null }, select: { id: true, size: true, label: true }, orderBy: [{ size: "asc" }, { label: "asc" }] });
const onSiteRows = () =>
  prisma.binMovement.findMany({
    where: { status: "ON_SITE" },
    select: { id: true, projectId: true, binId: true, size: true, use: true, contents: true, contentsNote: true, status: true, deliveredAt: true, pickedUpAt: true, bin: { select: { label: true } } },
    orderBy: { deliveredAt: "asc" },
    take: 500,
  });

type RowIn = { id: string; projectId: string; size: string; use: string; contents: string; contentsNote: string | null; status: string; deliveredAt: Date; pickedUpAt: Date | null; bin: { label: string } | null };
async function linkRows(rows: RowIn[]): Promise<BinLinkRowDTO[]> {
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true } });
  const name = (pid: string) => linkLabel(projects.find((p) => p.id === pid)?.name ?? "a job", "Unnamed site");
  const now = new Date();
  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, project: name(r.projectId),
    bin: linkLabel(r.bin?.label ?? sizeLabel(r.size), sizeLabel(r.size)), size: sizeLabel(r.size), use: useLabel(r.use),
    contents: linkLabel(contentsLabel(r.contents, r.contentsNote), "Other"),
    delivered: dayText(r.deliveredAt), days: daysText(daysOut(r.deliveredAt, r.pickedUpAt ?? now)),
    status: STATUS_LABEL[r.status as BinStatus] ?? r.status,
  }));
}

export async function binOptions(link: BinLink): Promise<BinLinkOptionsDTO> {
  const since = sydneyMidnight();
  const [projects, bins, onSite, today] = await Promise.all([
    linkProjects(link.person.id),
    activeBins(),
    onSiteRows(),
    prisma.binMovement.findMany({
      where: { OR: [{ deliveredByResourceId: link.person.id, deliveredAt: { gte: since } }, { pickedUpByResourceId: link.person.id, pickedUpAt: { gte: since } }] },
      select: { id: true, projectId: true, size: true, use: true, contents: true, contentsNote: true, status: true, deliveredAt: true, pickedUpAt: true, bin: { select: { label: true } } },
      orderBy: { deliveredAt: "desc" }, take: 60,
    }),
  ]);
  const out = new Set(onSite.map((m) => m.binId).filter(Boolean));
  return {
    projects,
    uses: BIN_USES.map((u) => ({ ...u })),
    sizes: BIN_SIZES.map((s) => ({ key: s.key, label: s.label, free: bins.filter((b) => b.size === s.key && !out.has(b.id)).map((b) => ({ id: b.id, label: linkLabel(b.label, s.label) })) })),
    contents: BIN_CONTENTS.map((c) => ({ ...c })),
    onSite: await linkRows(onSite),
    today: await linkRows(today),
  };
}

// One bin photo from a link (stored like a receipt photo - same type, size and first-bytes checks).
export async function uploadBinPhoto(link: { id: string; person: { name: string } }, dataUrl: unknown): Promise<{ id: string } | Problem> {
  const sent = await prisma.binPhoto.count({ where: { siteLinkId: link.id, createdAt: { gte: since24h() } } });
  if (sent >= LIMITS.photosPerLinkPerDay) return { error: "That's the most bin photos this link can send in a day - call the office.", status: 429 };
  const saved = await saveReceiptPhoto(dataUrl);
  if ("error" in saved) return { error: saved.error, status: 400 };
  const p = await prisma.binPhoto.create({ data: { fileName: saved.fileName, siteLinkId: link.id, takenBy: link.person.name } });
  return { id: p.id };
}

// Only photos this link uploaded in the last day and not already on a bin.
async function ownPhotos(linkId: string, photoIds: string[]) {
  const photos = await prisma.binPhoto.findMany({ where: { id: { in: photoIds }, siteLinkId: linkId, movementId: null, createdAt: { gte: since24h() } }, select: { id: true } });
  return photos.length === photoIds.length;
}
async function movesToday(linkId: string) {
  return prisma.binMovement.count({ where: { OR: [{ deliveredLinkId: linkId, deliveredAt: { gte: since24h() } }, { pickedUpLinkId: linkId, pickedUpAt: { gte: since24h() } }] } });
}

export type DeliverResult = { row: BinLinkRowDTO; message: string; warning: string | null };
export async function deliverBin(link: BinLink, body: Record<string, unknown>): Promise<DeliverResult | Problem> {
  const input = parseDelivery(body);
  if ("error" in input) return { error: input.error, status: 400 };
  if ((await movesToday(link.id)) >= LIMITS.movesPerLinkPerDay) return { error: "That's the most bins this link can record in a day - call the office.", status: 429 };
  if (!(await ownPhotos(link.id, input.photoIds))) return { error: "A photo didn't upload - take it again.", status: 400 };
  const project = await prisma.project.findFirst({ where: { id: input.projectId, status: "ACTIVE", archived: false }, select: { id: true } });
  if (!project) return { error: "Pick the job from the list - call the office if it isn't there.", status: 400 };
  const [bins, onSite] = await Promise.all([activeBins(), onSiteRows()]);
  const out = new Set(onSite.map((m) => m.binId).filter(Boolean));
  const pick = chooseBin(input, bins.filter((b) => !out.has(b.id)));
  if ("error" in pick) return { error: pick.error, status: 409 };
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const m = await tx.binMovement.create({
        data: {
          projectId: input.projectId, binId: pick.binId, size: input.size, use: input.use, contents: input.contents, contentsNote: input.contentsNote,
          status: "ON_SITE", onSiteKey: pick.binId, deliveredBy: link.person.name, deliveredByResourceId: link.person.id, deliveredLinkId: link.id,
        },
      });
      // Conditional: only photos still free - a second phone can't take them.
      const n = await tx.binPhoto.updateMany({ where: { id: { in: input.photoIds }, siteLinkId: link.id, movementId: null }, data: { movementId: m.id, stage: "DELIVERED" } });
      if (n.count !== input.photoIds.length) throw new BinError("A photo didn't upload - take it again.");
      return m.id;
    });
  } catch (e) {
    if (isUnique(e)) return { error: "That bin is already on site - pick it up first, or pick another bin.", status: 409 };
    if (e instanceof BinError) return { error: e.message, status: e.status };
    throw e;
  }
  // A client's bin: one quiet alert to the coordinator (Alex) - never for our bin; never holds up the reply.
  if (input.use === "CLIENT") void alertClientBin(id).catch(() => {});
  const after = await onSiteRows();
  const warning = overFleet(after, bins).find((w) => w.size === input.size)?.text ?? null;
  const row = (await linkRows(after.filter((m) => m.id === id)))[0];
  return { row, message: `${row?.bin ?? sizeLabel(input.size)} delivered to ${row?.project ?? "the job"} - thanks.`, warning: warning ? "The office will check the bin register." : null };
}

// The phone alert to Alex (Ilies, 23 Nov 2026: "Yes, alert Alex"): to every active COORDINATOR login's own phones (the
// devices it turned alerts on for - none, nothing sent), through lib/push.ts like the other single-person alerts.
// Kill switch BIN_ALERTS=off. Words only (clientBinAlert): the job and the size. Returns how many phones it reached.
export async function alertClientBin(movementId: string): Promise<number> {
  if (!binAlertsOn()) return 0;
  const m = await prisma.binMovement.findUnique({ where: { id: movementId }, select: { id: true, use: true, size: true, projectId: true } });
  if (!m) return 0;
  const project = await prisma.project.findUnique({ where: { id: m.projectId }, select: { name: true } });
  const msg = clientBinAlert({ id: m.id, use: m.use, size: m.size, project: project?.name ?? "a job" });
  if (!msg) return 0;
  const coordinators = await prisma.user.findMany({ where: { role: "COORDINATOR", active: true }, select: { id: true } });
  return pushToUsers(coordinators.map((u) => u.id), msg, "normal");
}

export async function pickUpBin(link: BinLink, body: Record<string, unknown>): Promise<{ row: BinLinkRowDTO; message: string } | Problem> {
  const input = parsePickup(body);
  if ("error" in input) return { error: input.error, status: 400 };
  if ((await movesToday(link.id)) >= LIMITS.movesPerLinkPerDay) return { error: "That's the most bins this link can record in a day - call the office.", status: 429 };
  if (!(await ownPhotos(link.id, input.photoIds))) return { error: "A photo didn't upload - take it again.", status: 400 };
  try {
    await prisma.$transaction(async (tx) => {
      // Conditional: only a bin still on site - two phones can't both pick it up.
      const n = await tx.binMovement.updateMany({
        where: { id: input.movementId, status: "ON_SITE" },
        data: { status: "PICKED_UP", onSiteKey: null, pickedUpAt: new Date(), pickedUpBy: link.person.name, pickedUpByResourceId: link.person.id, pickedUpLinkId: link.id },
      });
      if (n.count !== 1) throw new BinError("That bin has already been picked up (or isn't on site) - check the list.", 409);
      const p = await tx.binPhoto.updateMany({ where: { id: { in: input.photoIds }, siteLinkId: link.id, movementId: null }, data: { movementId: input.movementId, stage: "PICKED_UP" } });
      if (p.count !== input.photoIds.length) throw new BinError("A photo didn't upload - take it again.");
    });
  } catch (e) {
    if (e instanceof BinError) return { error: e.message, status: e.status };
    throw e;
  }
  const m = await prisma.binMovement.findUnique({ where: { id: input.movementId }, include: { bin: { select: { label: true } } } });
  const row = (await linkRows(m ? [m] : []))[0];
  return { row, message: `${row?.bin ?? "Bin"} picked up from ${row?.project ?? "the job"} - thanks. Send the tip docket from Add receipt when you tip it.` };
}

// ---------- the office (Manager+, the coordinator view-only) ----------

export type BinPhotoDTO = { id: string; stage: string | null };
export type TipDTO = { receiptId: string; docketNo: string | null; docketAt: string | null; sentAt: string; sentBy: string; tipSite: string | null; wasteType: string | null; tonnes: number | null; sameDriver: boolean };
export type BinOfficeRowDTO = {
  id: string; projectId: string; project: string; jobNo: string | null; client: string | null;
  binId: string | null; bin: string; size: string; sizeKey: string; use: string; useKey: string; contents: string; contentsKey: string; contentsNote: string | null;
  status: string; statusKey: string; deliveredAt: string; deliveredBy: string; pickedUpAt: string | null; pickedUpBy: string | null; days: number;
  photos: BinPhotoDTO[]; tip: TipDTO | null; suggestions: TipDTO[]; cancelled: { by: string | null; reason: string | null } | null;
};
export type BinRegisterDTO = { id: string; size: string; sizeKey: string; label: string; retired: boolean; retireReason: string | null; onSite: string | null };
export type BinFilters = { projectId?: string; use?: string; from?: string; to?: string; status?: string };
export type BinsOfficeDTO = {
  out: BinOfficeRowDTO[]; history: BinOfficeRowDTO[]; register: BinRegisterDTO[]; warnings: FleetWarning[];
  projects: { id: string; label: string }[]; pickProjects: { id: string; label: string }[]; sizes: { key: string; label: string }[]; uses: { key: string; label: string }[]; contents: { key: string; label: string }[];
  // Client's bins are charged per bin (Ilies, 23 Nov 2026) - counted per job: delivered in the range, of which on site now
  // and picked up. No days figure here.
  clientByJob: { projectId: string; project: string; jobNo: string | null; client: string | null; delivered: number; onSite: number; pickedUp: number }[];
  range: { from: string; to: string };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const tipFields = { id: true, kind: true, status: true, projectId: true, siteLinkId: true, sentByResourceId: true, sentBy: true, sentAt: true, docketAt: true, docketNo: true, tipSite: true, wasteType: true, tonnes: true } as const;
type TipRow = { id: string; kind: string; status: string; projectId: string | null; siteLinkId: string; sentByResourceId: string | null; sentBy: string; sentAt: Date; docketAt: Date | null; docketNo: string | null; tipSite: string | null; wasteType: string | null; tonnes: number | null };
// No price is ever selected - this page is money-free (the coordinator reads it).
const tipDTO = (r: TipRow, sameDriver = false): TipDTO => ({ receiptId: r.id, docketNo: r.docketNo, docketAt: iso(r.docketAt), sentAt: r.sentAt.toISOString(), sentBy: r.sentBy, tipSite: r.tipSite, wasteType: r.wasteType, tonnes: r.tonnes, sameDriver });

type MoveRow = Prisma.BinMovementGetPayload<{ include: { bin: { select: { label: true } }; photos: { select: { id: true; stage: true } } } }>;
async function officeRows(rows: MoveRow[], withSuggestions: boolean): Promise<BinOfficeRowDTO[]> {
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true, jobNo: true, client: true } });
  const tipIds = rows.map((r) => r.tipReceiptId).filter((x): x is string => !!x);
  const picked = rows.filter((r) => r.status === "PICKED_UP" && !r.tipReceiptId && r.pickedUpAt);
  const times = picked.map((r) => r.pickedUpAt!.getTime());
  const [confirmed, pool, taken] = await Promise.all([
    tipIds.length ? prisma.receipt.findMany({ where: { id: { in: tipIds } }, select: tipFields }) : [],
    withSuggestions && picked.length
      ? prisma.receipt.findMany({
          where: {
            kind: "TIP", status: { not: "REJECTED" }, projectId: { in: [...new Set(picked.map((r) => r.projectId))] },
            OR: [
              { docketAt: { gte: new Date(Math.min(...times) - 86_400_000), lte: new Date(Math.max(...times) + 3 * 86_400_000) } },
              { docketAt: null, sentAt: { gte: new Date(Math.min(...times) - 86_400_000), lte: new Date(Math.max(...times) + 3 * 86_400_000) } },
            ],
          },
          select: tipFields, take: 2000,
        })
      : [],
    prisma.binMovement.findMany({ where: { tipReceiptId: { not: null } }, select: { id: true, tipReceiptId: true } }),
  ]);
  const now = new Date();
  return rows.map((r) => {
    const p = projects.find((x) => x.id === r.projectId);
    const tip = confirmed.find((x) => x.id === r.tipReceiptId);
    const elsewhere = new Set(taken.filter((t) => t.id !== r.id).map((t) => t.tipReceiptId!));
    const suggestions = withSuggestions && r.status === "PICKED_UP" && !r.tipReceiptId ? tipCandidates(r, pool, elsewhere).map((x) => tipDTO(x, x.sameDriver)) : [];
    return {
      id: r.id, projectId: r.projectId, project: p?.name ?? "(job not found)", jobNo: p?.jobNo ?? null, client: p?.client ?? null,
      binId: r.binId, bin: r.bin?.label ?? sizeLabel(r.size), size: sizeLabel(r.size), sizeKey: r.size, use: useLabel(r.use), useKey: r.use,
      contents: contentsLabel(r.contents, r.contentsNote), contentsKey: r.contents, contentsNote: r.contentsNote,
      status: STATUS_LABEL[r.status as BinStatus] ?? r.status, statusKey: r.status,
      deliveredAt: r.deliveredAt.toISOString(), deliveredBy: r.deliveredBy, pickedUpAt: iso(r.pickedUpAt), pickedUpBy: r.pickedUpBy,
      days: daysOut(r.deliveredAt, r.pickedUpAt ?? r.cancelledAt ?? now),
      photos: r.photos.map((ph) => ({ id: ph.id, stage: ph.stage })),
      tip: tip ? tipDTO(tip) : null, suggestions,
      cancelled: r.status === "CANCELLED" ? { by: r.cancelledBy, reason: r.cancelReason } : null,
    };
  });
}
const moveInclude = { bin: { select: { label: true } }, photos: { select: { id: true, stage: true }, orderBy: { createdAt: "asc" as const } } };

export async function officeBins(f: BinFilters): Promise<BinsOfficeDTO> {
  const today = signinDates().today;
  const to = f.to && DAY.test(f.to) ? f.to : today;
  const from = f.from && DAY.test(f.from) ? f.from : new Date(Date.parse(`${to}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const fromAt = fromSydneyLocal(`${from}T00:00`)!, toAt = new Date(fromSydneyLocal(`${to}T00:00`)!.getTime() + 86_400_000);
  const scope = { ...(f.projectId ? { projectId: f.projectId.slice(0, 40) } : {}), ...(f.use === "CLIENT" || f.use === "OURS" ? { use: f.use } : {}) };
  const historyStatus = f.status === "CANCELLED" ? ["CANCELLED"] : f.status === "PICKED_UP" ? ["PICKED_UP"] : ["PICKED_UP", "CANCELLED"];
  const [outRows, histRows, bins, everProjects, clientRows] = await Promise.all([
    prisma.binMovement.findMany({ where: { status: "ON_SITE", ...scope }, include: moveInclude, orderBy: { deliveredAt: "asc" }, take: 500 }),
    prisma.binMovement.findMany({
      where: { status: { in: historyStatus }, ...scope, OR: [{ pickedUpAt: { gte: fromAt, lt: toAt } }, { pickedUpAt: null, deliveredAt: { gte: fromAt, lt: toAt } }] },
      include: moveInclude, orderBy: [{ pickedUpAt: "desc" }, { deliveredAt: "desc" }], take: 400,
    }),
    prisma.bin.findMany({ orderBy: [{ retiredAt: "asc" }, { size: "asc" }, { label: "asc" }] }),
    prisma.binMovement.findMany({ select: { projectId: true }, distinct: ["projectId"] }),
    // Client's bins delivered in the range (the job filter applies; the client / ours filter doesn't - these are all client's).
    prisma.binMovement.findMany({
      where: { use: "CLIENT", deliveredAt: { gte: fromAt, lt: toAt }, ...(scope.projectId ? { projectId: scope.projectId } : {}) },
      select: { projectId: true, use: true, status: true }, take: 5000,
    }),
  ]);
  const allOut = scope.projectId || scope.use ? await prisma.binMovement.findMany({ where: { status: "ON_SITE" }, select: { size: true, binId: true, projectId: true } }) : outRows;
  const [out, history, projects, pickProjects] = await Promise.all([
    officeRows(outRows, false),
    officeRows(histRows, true),
    prisma.project.findMany({ where: { id: { in: everProjects.map((p) => p.projectId) } }, select: { id: true, name: true, jobNo: true }, orderBy: { name: "asc" } }),
    // What a correction can move an entry to: every project not archived (the office picker - active ones first).
    prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, jobNo: true, status: true }, orderBy: { name: "asc" }, take: 1000 }),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  // Client's bins by job (Alex tracks them as variations; charged per bin - Ilies, 23 Nov 2026): how many were delivered.
  const counts = clientBinCounts(clientRows);
  const countProjects = await prisma.project.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, name: true, jobNo: true, client: true } });
  const clientByJob = countProjects.map((p) => ({ projectId: p.id, project: p.name, jobNo: p.jobNo, client: p.client, ...counts.get(p.id)! }));
  const active = bins.filter((b) => !b.retiredAt);
  return {
    out, history,
    // The register in the size list's order (15, 11, 9, 8, hook), retired ones last.
    register: [...bins].sort((a, b) => Number(!!a.retiredAt) - Number(!!b.retiredAt) || BIN_SIZES.findIndex((s) => s.key === a.size) - BIN_SIZES.findIndex((s) => s.key === b.size) || a.label.localeCompare(b.label)).map((b) => {
      const at = allOut.find((m) => m.binId === b.id);
      return { id: b.id, size: sizeLabel(b.size), sizeKey: b.size, label: b.label, retired: !!b.retiredAt, retireReason: b.retireReason, onSite: at ? projectName.get(at.projectId) ?? "a job" : null };
    }),
    warnings: overFleet(allOut, active),
    projects: projects.map((p) => ({ id: p.id, label: p.jobNo ? `${p.name} (${p.jobNo})` : p.name })),
    pickProjects: [...pickProjects].sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: `${p.jobNo ? `${p.name} (${p.jobNo})` : p.name}${p.status === "ACTIVE" ? "" : ` - ${p.status.toLowerCase()}`}` })),
    sizes: BIN_SIZES.map((s) => ({ key: s.key, label: s.label })), uses: BIN_USES.map((u) => ({ key: u.key, label: u.label })), contents: BIN_CONTENTS.map((c) => ({ ...c })),
    clientByJob: clientByJob.sort((a, b) => b.delivered - a.delivered || b.onSite - a.onSite || a.project.localeCompare(b.project)),
    range: { from, to },
  };
}

// The compact "Bins out" card (Ilies's board, the coordinator's dashboard): how many bins are on site, by job - counts
// only (client's bins are charged per bin), no days and no money.
export type BinsSummaryDTO = { out: number; client: number; ours: number; warnings: FleetWarning[]; jobs: { projectId: string; project: string; client: number; ours: number }[] };
export async function binsSummary(): Promise<BinsSummaryDTO> {
  const [rows, bins] = await Promise.all([
    prisma.binMovement.findMany({ where: { status: "ON_SITE" }, select: { projectId: true, use: true, size: true } }),
    prisma.bin.findMany({ where: { retiredAt: null }, select: { size: true } }),
  ]);
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true } });
  const jobs = new Map<string, BinsSummaryDTO["jobs"][number]>();
  for (const r of rows) {
    const j = jobs.get(r.projectId) ?? { projectId: r.projectId, project: projects.find((p) => p.id === r.projectId)?.name ?? "a job", client: 0, ours: 0 };
    if (r.use === "CLIENT") j.client++; else j.ours++;
    jobs.set(r.projectId, j);
  }
  return {
    out: rows.length, client: rows.filter((r) => r.use === "CLIENT").length, ours: rows.filter((r) => r.use !== "CLIENT").length,
    warnings: overFleet(rows, bins),
    jobs: [...jobs.values()].sort((a, b) => b.client - a.client || b.ours - a.ours || a.project.localeCompare(b.project)),
  };
}

// ---------- the office's writes (Manager+ only; every change in RecordChange) ----------

const ctx = (by: Who, reason?: string | null) => ({ by, source: "Bins page", reason: reason ?? null });

export async function addBin(sizeIn: unknown, labelIn: unknown, by: Who) {
  if (!isBinSize(sizeIn)) throw new BinError("Pick the bin's size.");
  const size = sizeIn;
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const same = await tx.bin.findMany({ where: { size }, select: { label: true } });
    const label = labelIn === undefined || labelIn === null || labelIn === "" ? defaultLabel(size, same.map((b) => b.label)) : binLabel(labelIn);
    if (typeof label !== "string") throw new BinError(label.error);
    const clash = await tx.bin.findFirst({ where: { retiredAt: null, label } });
    if (clash) throw new BinError(`There's already a bin called "${label}".`, 409);
    const row = await tx.bin.create({ data: { size, label, createdBy: byName(by).slice(0, 120), createdById: by?.id ?? null } });
    await writeChanges(tx, "Bin", row.id, [{ field: "size", before: null, after: size }, { field: "label", before: null, after: label }], ctx(by));
    return row;
  });
}

export async function changeBin(idIn: unknown, body: Record<string, unknown>, by: Who) {
  if (typeof idIn !== "string" || idIn.length > 64) throw new BinError("Unknown bin.", 404);
  const action = body.action;
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const existing = await tx.bin.findUnique({ where: { id: idIn } });
    if (!existing) throw new BinError("Unknown bin.", 404);
    let data: Record<string, unknown>;
    let reason: string | null = null;
    if (action === "rename") {
      const label = binLabel(body.label);
      if (typeof label !== "string") throw new BinError(label.error);
      if (label === existing.label) throw new BinError("That's already its name.");
      if (await tx.bin.findFirst({ where: { retiredAt: null, label, id: { not: existing.id } } })) throw new BinError(`There's already a bin called "${label}".`, 409);
      data = { label };
    } else if (action === "retire") {
      reason = tidy(body.reason, 300);
      if (reason.length < 3) throw new BinError("Say why the bin is being retired.");
      if (existing.retiredAt) throw new BinError("That bin is already retired.", 409);
      if (await tx.binMovement.findFirst({ where: { binId: existing.id, status: "ON_SITE" } })) throw new BinError("That bin is on site - record its pick-up first.", 409);
      data = { retiredAt: new Date(), retiredBy: byName(by).slice(0, 120), retireReason: reason };
    } else if (action === "restore") {
      if (!existing.retiredAt) throw new BinError("That bin isn't retired.", 409);
      if (await tx.bin.findFirst({ where: { retiredAt: null, label: existing.label } })) throw new BinError(`Another bin is called "${existing.label}" - rename one first.`, 409);
      data = { retiredAt: null, retiredBy: null, retireReason: null };
    } else throw new BinError("Unknown action.");
    const row = await tx.bin.update({ where: { id: existing.id }, data });
    await recordChanges(tx, "Bin", existing.id, existing, row, ctx(by, reason), Object.keys(data));
    return row;
  });
}

// A correction, a cancel, putting a wrong pick-up back on site, or the tip docket decision - one movement.
export async function changeMovement(idIn: unknown, body: Record<string, unknown>, by: Who) {
  if (typeof idIn !== "string" || idIn.length > 64) throw new BinError("Unknown bin entry.", 404);
  const action = body.action;
  try {
    return await prisma.$transaction(async (tx) => {
      await writeLock(tx);
      const m = await tx.binMovement.findUnique({ where: { id: idIn } });
      if (!m) throw new BinError("Unknown bin entry.", 404);
      let data: Record<string, unknown>;
      let reason: string | null = null;
      if (action === "correct") {
        if (m.status === "CANCELLED") throw new BinError("A cancelled entry can't be changed.", 409);
        const c = parseCorrection(body);
        if ("error" in c) throw new BinError(c.error);
        reason = c.reason;
        const f = { ...c.fields };
        if (f.projectId && f.projectId !== m.projectId) {
          // BN-003 (Ilies approved 23 Nov 2026): a matched tip docket belongs to the job it was on - take it off first;
          // and never onto an archived project.
          if (m.tipReceiptId) throw new BinError("Take the tip docket off first.", 409);
          if (!(await tx.project.findFirst({ where: { id: f.projectId, archived: false }, select: { id: true } }))) throw new BinError("Pick the job.");
        }
        const size = f.size ?? m.size;
        if (f.size && f.size !== m.size && f.binId === undefined) f.binId = null; // a new size: the old bin no longer fits
        if (f.binId) {
          const bin = await tx.bin.findUnique({ where: { id: f.binId } });
          if (!bin || bin.retiredAt) throw new BinError("Pick a bin from the register.");
          if (bin.size !== size) throw new BinError("That bin is a different size.");
        }
        const contents = f.contents ?? m.contents;
        const note = f.contentsNote !== undefined ? f.contentsNote : m.contentsNote;
        if (contents === "OTHER" && !note) throw new BinError("Say what's in it (Other).");
        data = { ...f };
        if (f.binId !== undefined && m.status === "ON_SITE") data.onSiteKey = f.binId;
        if (Object.entries(f).every(([k, v]) => (m as unknown as Record<string, unknown>)[k] === v)) throw new BinError("Nothing to change.");
      } else if (action === "cancel") {
        reason = tidy(body.reason, 300);
        if (reason.length < 3) throw new BinError("Say why it's being cancelled.");
        if (!canMove(m.status, "CANCELLED")) throw new BinError("That entry is already cancelled.", 409);
        data = { status: "CANCELLED", onSiteKey: null, cancelledAt: new Date(), cancelledBy: byName(by).slice(0, 120), cancelReason: reason, tipReceiptId: null, tipConfirmedBy: null, tipConfirmedAt: null };
      } else if (action === "unpick") {
        reason = tidy(body.reason, 300);
        if (reason.length < 3) throw new BinError("Say why it's going back on site.");
        if (!canMove(m.status, "ON_SITE")) throw new BinError("Only a picked-up bin can be put back on site.", 409);
        // BN-004 (Ilies approved 23 Nov 2026): a retired bin can't go back on site.
        if (m.binId && (await tx.bin.findUnique({ where: { id: m.binId }, select: { retiredAt: true } }))?.retiredAt) {
          throw new BinError("That bin is retired - bring it back in the register first.", 409);
        }
        data = { status: "ON_SITE", onSiteKey: m.binId, pickedUpAt: null, pickedUpBy: null, pickedUpByResourceId: null, pickedUpLinkId: null, tipReceiptId: null, tipConfirmedBy: null, tipConfirmedAt: null };
        // The pick-up photos stay on the entry, marked as an undone pick-up.
        await tx.binPhoto.updateMany({ where: { movementId: m.id, stage: "PICKED_UP" }, data: { stage: "PICKED_UP_UNDONE" } });
      } else if (action === "tip-confirm") {
        if (m.status !== "PICKED_UP" || !m.pickedUpAt) throw new BinError("Only a picked-up bin has a tip docket.", 409);
        if (m.tipReceiptId) throw new BinError("This bin already has a tip docket - take it off first.", 409);
        const rid = typeof body.receiptId === "string" ? body.receiptId.slice(0, 40) : "";
        const r = await tx.receipt.findUnique({ where: { id: rid }, select: { id: true, kind: true, status: true, projectId: true, sentAt: true, docketAt: true } });
        if (!r || r.kind !== "TIP" || r.status === "REJECTED") throw new BinError("Pick one of the tip dockets.");
        if (r.projectId !== m.projectId) throw new BinError("That docket is for another job.");
        if (!inWindow(m, r, CONFIRM_WINDOW)) throw new BinError("That docket is too far from the pick-up date.");
        if (await tx.binMovement.findFirst({ where: { tipReceiptId: r.id, id: { not: m.id } } })) throw new BinError("That docket is already matched to another bin.", 409);
        const rejected = rejectedOf(m.tipRejectedIds);
        data = { tipReceiptId: r.id, tipConfirmedBy: byName(by).slice(0, 120), tipConfirmedAt: new Date(), ...(rejected.includes(r.id) ? { tipRejectedIds: JSON.stringify(rejected.filter((x) => x !== r.id)) } : {}) };
      } else if (action === "tip-reject") {
        const rid = typeof body.receiptId === "string" ? body.receiptId.slice(0, 40) : "";
        if (!rid) throw new BinError("Which docket?");
        const list = rejectedOf(m.tipRejectedIds);
        if (list.includes(rid) && m.tipReceiptId !== rid) throw new BinError("Already marked as not this bin's.", 409);
        data = { tipRejectedIds: JSON.stringify([...new Set([...list, rid])].slice(-50)), ...(m.tipReceiptId === rid ? { tipReceiptId: null, tipConfirmedBy: null, tipConfirmedAt: null } : {}) };
      } else throw new BinError("Unknown action.");
      // Conditional on the status read above - a pick-up from a phone in between makes this one fail, not overwrite it.
      const n = await tx.binMovement.updateMany({ where: { id: m.id, status: m.status }, data });
      if (n.count !== 1) throw new BinError("It changed while you were looking - reload and try again.", 409);
      const row = await tx.binMovement.findUniqueOrThrow({ where: { id: m.id } });
      await recordChanges(tx, "BinMovement", m.id, m, row, ctx(by, reason), Object.keys(data).filter((k) => k !== "onSiteKey"));
      return row;
    });
  } catch (e) {
    if (isUnique(e)) throw new BinError("That bin is already on site on another entry - fix that one first.", 409);
    throw e;
  }
}
