// Tipper loads (Ilies, 27 Nov 2026), server side: what a DRIVER link can pick and send (a load with its photos), the
// office's Tipper loads tab on the Bins page (loads, our tippers, tip docket suggestions, client's loads by job) and the
// office's writes (correct, cancel, tip docket confirm / reject, the "is it a tipper?" switch). Rules: ./tipperRules.ts.
// Nothing here touches jobs, sign-ins, allocations, costs or tip cost maths; no row is ever deleted; a link never gets
// a price back; every office change is in RecordChange with its reason.
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { linkLabel } from "../dailyLog/money";
import { signinDates } from "../signin";
import { fromSydneyLocal } from "../shiftTimes";
import { savePhotoUnderCap } from "../uploadCaps";
import { assertNoMoney } from "../moneyGuard";
import { writeChanges, recordChanges, writeLock, type Who } from "../history/store";
import type { BinLink } from "../siteLinks";
import { pushToUsers } from "../push";
import { BinError, NO_AMOUNT_REASON, clientTipperCounts, linkProjects, refuseAgent, tipDTO, tipFields, type Actor, type TipDTO } from "./store";
import { CONFIRM_WINDOW, contentsLabel, inWindow, rejectedOf, tidy, tipCandidates } from "./rules";
import {
  TIPPER_CONTENTS, TIPPER_LIMITS, TIPPER_STATUS_LABEL, TIPPER_USES, clientTipperAlert, isTipper, loadAsPickUp, parseTipperCorrection, parseTipperFlag,
  parseTipperLoad, prefillTipper, takenDockets, timeText, tipperAlertsOn, tipperList, tipperUseLabel,
  type TipperLinkOptionsDTO, type TipperLinkRowDTO,
} from "./tipperRules";

type Problem = { error: string; status: number };
const since24h = () => new Date(Date.now() - 24 * 3_600_000);
const sydneyMidnight = () => fromSydneyLocal(`${signinDates().today}T00:00`)!;
const byName = (w: Who) => (w?.name && w.name.trim()) || "Operations";
const LOADS_CAP = "That's the most loads this link can record in a day - call the office.";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---------- our tippers ----------

async function fleet() {
  const [vehicles, flags] = await Promise.all([
    prisma.resource.findMany({ where: { type: "VEHICLE" }, select: { id: true, name: true, type: true, ownership: true, active: true, identifier: true }, take: 500 }),
    prisma.tipperVehicle.findMany({ select: { vehicleId: true, tipper: true } }),
  ]);
  return tipperList(vehicles, new Map(flags.map((f) => [f.vehicleId, f.tipper])));
}
export async function ourTippers() {
  return (await fleet()).filter((v) => v.tipper);
}

// ---------- the link (DRIVER only) ----------

export function isDriverLink(link: BinLink | null): link is BinLink {
  return !!link && link.kind === "DRIVER";
}

async function linkRows(rows: { id: string; vehicleLabel: string; projectId: string; use: string; contents: string; contentsNote: string | null; status: string; loadedAt: Date }[]): Promise<TipperLinkRowDTO[]> {
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true } });
  const name = (pid: string) => linkLabel(projects.find((p) => p.id === pid)?.name ?? "a job", "Unnamed site");
  return rows.map((r) => ({
    id: r.id, tipper: linkLabel(r.vehicleLabel, "Tipper"), project: name(r.projectId), use: tipperUseLabel(r.use),
    contents: linkLabel(contentsLabel(r.contents, r.contentsNote), "Other"), at: timeText(r.loadedAt), status: TIPPER_STATUS_LABEL[r.status] ?? r.status,
  }));
}
const linkRowSelect = { id: true, vehicleLabel: true, projectId: true, use: true, contents: true, contentsNote: true, status: true, loadedAt: true } as const;

export async function tipperOptions(link: BinLink): Promise<TipperLinkOptionsDTO> {
  const { today } = signinDates();
  const [projects, tippers, signIns, mine] = await Promise.all([
    linkProjects(link.person.id),
    ourTippers(),
    prisma.siteAttendance.findMany({ where: { resourceId: link.person.id, place: "VEHICLE", date: today }, select: { vehicleId: true, signInAt: true, status: true, removedAt: true }, take: 20 }),
    prisma.tipperLoad.findMany({ where: { linkId: link.id, loadedAt: { gte: sydneyMidnight() } }, select: linkRowSelect, orderBy: { loadedAt: "desc" }, take: 60 }),
  ]);
  return {
    tippers: tippers.map((t) => ({ id: t.id, label: linkLabel(t.name, t.identifier ?? "Tipper") })),
    prefill: prefillTipper(signIns, new Set(tippers.map((t) => t.id))),
    projects,
    uses: TIPPER_USES.map((u) => ({ ...u })),
    contents: TIPPER_CONTENTS.map((c) => ({ ...c })),
    today: await linkRows(mine),
  };
}

// One load photo from a driver's link (stored like a receipt / bin photo - same type, size and first-bytes checks).
// TL-001 (Ilies approved 27 Nov 2026): the day's cap is counted again just before the save, one save at a time per link (lib/uploadCaps.ts), and at
// most 3 uploads per link are in progress at once. TL-002: the photo's sha256 is kept, so the office sees a photo reused.
export async function uploadTipperPhoto(link: { id: string; person: { name: string } }, dataUrl: unknown): Promise<{ id: string } | Problem> {
  const capMessage = "That's the most load photos this link can send in a day - call the office.";
  const sent = await prisma.tipperLoadPhoto.count({ where: { siteLinkId: link.id, createdAt: { gte: since24h() } } });
  if (sent >= TIPPER_LIMITS.photosPerLinkPerDay) return { error: capMessage, status: 429 };
  return savePhotoUnderCap({
    key: `tipper:${link.id}`, dataUrl, cap: TIPPER_LIMITS.photosPerLinkPerDay, capMessage,
    count: (tx) => tx.tipperLoadPhoto.count({ where: { siteLinkId: link.id, createdAt: { gte: since24h() } } }),
    create: async (tx, saved) => ({ id: (await tx.tipperLoadPhoto.create({ data: { fileName: saved.fileName, siteLinkId: link.id, takenBy: link.person.name, sha256: saved.sha256 } })).id }),
  });
}

export type LogResult = { row: TipperLinkRowDTO; message: string };
export async function logTipperLoad(link: BinLink, body: Record<string, unknown>): Promise<LogResult | Problem> {
  const input = parseTipperLoad(body);
  if ("error" in input) return { error: input.error, status: 400 };
  const sent = await prisma.tipperLoad.count({ where: { linkId: link.id, loadedAt: { gte: since24h() } } });
  if (sent >= TIPPER_LIMITS.loadsPerLinkPerDay) return { error: LOADS_CAP, status: 429 };
  // Only photos this link uploaded in the last day and not already on a load.
  const own = await prisma.tipperLoadPhoto.count({ where: { id: { in: input.photoIds }, siteLinkId: link.id, loadId: null, createdAt: { gte: since24h() } } });
  if (own !== input.photoIds.length) return { error: "A photo didn't upload - take it again.", status: 400 };
  const tipper = (await ourTippers()).find((t) => t.id === input.vehicleId);
  if (!tipper) return { error: "Pick the tipper from the list - call the office if it isn't there.", status: 400 };
  const project = await prisma.project.findFirst({ where: { id: input.projectId, status: "ACTIVE", archived: false }, select: { id: true } });
  if (!project) return { error: "Pick the job from the list - call the office if it isn't there.", status: 400 };
  // Was this tipper the prefill from today's truck sign-in? Recorded so the office can see it wasn't typed in blind.
  const signIns = await prisma.siteAttendance.findMany({ where: { resourceId: link.person.id, place: "VEHICLE", date: signinDates().today }, select: { vehicleId: true, signInAt: true, status: true, removedAt: true }, take: 20 });
  const fromSignIn = prefillTipper(signIns, new Set([tipper.id])) === tipper.id;
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      // TL-001: the day's cap again, under the write lock - parallel sends can't all pass the count above.
      await writeLock(tx);
      if ((await tx.tipperLoad.count({ where: { linkId: link.id, loadedAt: { gte: since24h() } } })) >= TIPPER_LIMITS.loadsPerLinkPerDay) throw new BinError(LOADS_CAP, 429);
      const l = await tx.tipperLoad.create({
        data: {
          vehicleId: tipper.id, vehicleLabel: tipper.name.slice(0, 120), vehicleFromSignIn: fromSignIn, projectId: input.projectId, use: input.use, contents: input.contents,
          contentsNote: input.contentsNote, status: "LOGGED", loadedBy: link.person.name, loadedByResourceId: link.person.id, linkId: link.id,
        },
      });
      // Conditional: only photos still free - a second phone (or a double tap) can't take them.
      const n = await tx.tipperLoadPhoto.updateMany({ where: { id: { in: input.photoIds }, siteLinkId: link.id, loadId: null }, data: { loadId: l.id } });
      if (n.count !== input.photoIds.length) throw new BinError("A photo didn't upload - take it again.");
      return l.id;
    });
  } catch (e) {
    if (e instanceof BinError) return { error: e.message, status: e.status };
    throw e;
  }
  // A client's load: one quiet alert to the coordinator (Alex) - never for our load; never holds up the reply.
  if (input.use === "CLIENT") void alertClientTipper(id).catch(() => {});
  const row = (await linkRows(await prisma.tipperLoad.findMany({ where: { id }, select: linkRowSelect })))[0];
  return { row, message: `${row?.tipper ?? "Tipper"} load from ${row?.project ?? "the job"} logged - thanks. Send the tip docket from Add receipt when you tip it.` };
}

// The phone alert to Alex: every active COORDINATOR login's own phones, like the client's bin alert. Kill switches
// BIN_ALERTS=off / TIPPER_ALERTS=off. Words only (clientTipperAlert): the job and the tipper. Returns how many phones.
export async function alertClientTipper(loadId: string): Promise<number> {
  if (!tipperAlertsOn()) return 0;
  const l = await prisma.tipperLoad.findUnique({ where: { id: loadId }, select: { use: true, vehicleLabel: true, projectId: true } });
  if (!l) return 0;
  const project = await prisma.project.findUnique({ where: { id: l.projectId }, select: { name: true } });
  const msg = clientTipperAlert({ use: l.use, tipper: l.vehicleLabel, project: project?.name ?? "a job", projectId: l.projectId });
  if (!msg) return 0;
  const coordinators = await prisma.user.findMany({ where: { role: "COORDINATOR", active: true }, select: { id: true } });
  return pushToUsers(coordinators.map((u) => u.id), msg, "normal");
}

// ---------- the office (Manager+, the coordinator view-only) ----------

export type TipperOfficeRowDTO = {
  id: string; projectId: string; project: string; jobNo: string | null; client: string | null;
  vehicleId: string; tipper: string; fromSignIn: boolean; use: string; useKey: string; contents: string; contentsKey: string; contentsNote: string | null;
  status: string; statusKey: string; loadedAt: string; loadedBy: string;
  photos: { id: string }[];
  // TL-002: another load has the very same photo (same SHA-256) - a flag for the office, never a refusal.
  samePhotoAs: { loadId: string; loadedAt: string; tipper: string }[];
  tip: TipDTO | null; suggestions: TipDTO[]; cancelled: { by: string | null; reason: string | null; at: string | null } | null;
};
export type TipperFleetDTO = { id: string; name: string; tipper: boolean; set: boolean };
export type TipperFilters = { projectId?: string; vehicleId?: string; use?: string; from?: string; to?: string; status?: string };
export type TipperOfficeDTO = {
  loads: TipperOfficeRowDTO[];
  fleet: TipperFleetDTO[]; // every owned, active vehicle: whether it's a tipper and whether the office set that
  tippers: { id: string; label: string }[]; // the filter list: today's tippers plus any vehicle a load names
  projects: { id: string; label: string }[]; pickProjects: { id: string; label: string }[];
  uses: { key: string; label: string }[]; contents: { key: string; label: string }[];
  clientByJob: { projectId: string; project: string; jobNo: string | null; client: string | null; loads: number }[];
  range: { from: string; to: string };
};

type LoadRow = Awaited<ReturnType<typeof loadRows>>[number];
const loadRows = (where: Prisma.TipperLoadWhereInput, take = 400) =>
  prisma.tipperLoad.findMany({ where, include: { photos: { select: { id: true, sha256: true }, orderBy: { createdAt: "asc" } } }, orderBy: { loadedAt: "desc" }, take });

async function officeRows(rows: LoadRow[]): Promise<TipperOfficeRowDTO[]> {
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true, jobNo: true, client: true } });
  const tipIds = rows.map((r) => r.tipReceiptId).filter((x): x is string => !!x);
  const open = rows.filter((r) => r.status === "LOGGED" && !r.tipReceiptId);
  const times = open.map((r) => r.loadedAt.getTime());
  const hashes = [...new Set(rows.flatMap((r) => r.photos.map((p) => p.sha256)).filter((x): x is string => !!x))];
  const [confirmed, pool, takenBins, takenLoads, sameHash] = await Promise.all([
    tipIds.length ? prisma.receipt.findMany({ where: { id: { in: tipIds } }, select: tipFields }) : [],
    open.length
      ? prisma.receipt.findMany({
          where: {
            kind: "TIP", status: { not: "REJECTED" }, projectId: { in: [...new Set(open.map((r) => r.projectId))] },
            OR: [
              { docketAt: { gte: new Date(Math.min(...times) - 86_400_000), lte: new Date(Math.max(...times) + 3 * 86_400_000) } },
              { docketAt: null, sentAt: { gte: new Date(Math.min(...times) - 86_400_000), lte: new Date(Math.max(...times) + 3 * 86_400_000) } },
            ],
          },
          select: tipFields, take: 2000,
        })
      : [],
    prisma.binMovement.findMany({ where: { tipReceiptId: { not: null } }, select: { id: true, tipReceiptId: true } }),
    prisma.tipperLoad.findMany({ where: { tipReceiptId: { not: null } }, select: { id: true, tipReceiptId: true } }),
    hashes.length
      ? prisma.tipperLoadPhoto.findMany({ where: { sha256: { in: hashes }, loadId: { not: null } }, select: { sha256: true, loadId: true, load: { select: { loadedAt: true, vehicleLabel: true } } }, take: 2000 })
      : [],
  ]);
  return rows.map((r) => {
    const mine = new Set(r.photos.map((p) => p.sha256).filter(Boolean));
    const others = new Map<string, { loadId: string; loadedAt: string; tipper: string }>();
    for (const h of sameHash) if (h.sha256 && mine.has(h.sha256) && h.loadId && h.loadId !== r.id && h.load) others.set(h.loadId, { loadId: h.loadId, loadedAt: h.load.loadedAt.toISOString(), tipper: h.load.vehicleLabel });
    const p = projects.find((x) => x.id === r.projectId);
    const tip = confirmed.find((x) => x.id === r.tipReceiptId);
    const suggestions = r.status === "LOGGED" && !r.tipReceiptId
      ? tipCandidates(loadAsPickUp(r), pool, takenDockets(takenBins, takenLoads, r.id)).map((x) => tipDTO(x, x.sameDriver))
      : [];
    return {
      id: r.id, projectId: r.projectId, project: p?.name ?? "(job not found)", jobNo: p?.jobNo ?? null, client: p?.client ?? null,
      vehicleId: r.vehicleId, tipper: r.vehicleLabel, fromSignIn: r.vehicleFromSignIn, use: tipperUseLabel(r.use), useKey: r.use,
      contents: contentsLabel(r.contents, r.contentsNote), contentsKey: r.contents, contentsNote: r.contentsNote,
      status: TIPPER_STATUS_LABEL[r.status] ?? r.status, statusKey: r.status, loadedAt: r.loadedAt.toISOString(), loadedBy: r.loadedBy,
      photos: r.photos.map((ph) => ({ id: ph.id })), samePhotoAs: [...others.values()].sort((a, b) => a.loadedAt.localeCompare(b.loadedAt)), tip: tip ? tipDTO(tip) : null, suggestions,
      cancelled: r.status === "CANCELLED" ? { by: r.cancelledBy, reason: r.cancelReason, at: iso(r.cancelledAt) } : null,
    };
  });
}

// The date range the Bins page uses: to = today unless given, from = 90 days before unless given (Sydney days).
export function tipperRange(f: { from?: string; to?: string }) {
  const to = f.to && DAY.test(f.to) ? f.to : signinDates().today;
  const from = f.from && DAY.test(f.from) ? f.from : new Date(Date.parse(`${to}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  return { from, to, fromAt: fromSydneyLocal(`${from}T00:00`)!, toAt: new Date(fromSydneyLocal(`${to}T00:00`)!.getTime() + 86_400_000) };
}

export async function officeTipperLoads(f: TipperFilters): Promise<TipperOfficeDTO> {
  const range = tipperRange(f);
  const projectId = f.projectId ? f.projectId.slice(0, 40) : undefined;
  const where = {
    loadedAt: { gte: range.fromAt, lt: range.toAt },
    ...(projectId ? { projectId } : {}),
    ...(f.vehicleId ? { vehicleId: f.vehicleId.slice(0, 40) } : {}),
    ...(f.use === "CLIENT" || f.use === "OURS" ? { use: f.use } : {}),
    ...(f.status === "LOGGED" || f.status === "CANCELLED" ? { status: f.status } : {}),
  };
  const [rows, vehicles, everProjects, everVehicles, pickProjects, counts] = await Promise.all([
    loadRows(where),
    fleet(),
    prisma.tipperLoad.findMany({ select: { projectId: true }, distinct: ["projectId"] }),
    prisma.tipperLoad.findMany({ select: { vehicleId: true, vehicleLabel: true }, distinct: ["vehicleId"] }),
    prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, jobNo: true, status: true }, orderBy: { name: "asc" }, take: 1000 }),
    clientTipperCounts(range, projectId),
  ]);
  const [loads, projects, countProjects] = await Promise.all([
    officeRows(rows),
    prisma.project.findMany({ where: { id: { in: everProjects.map((p) => p.projectId) } }, select: { id: true, name: true, jobNo: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, name: true, jobNo: true, client: true } }),
  ]);
  const tipperIds = new Map<string, string>();
  for (const v of vehicles) if (v.tipper) tipperIds.set(v.id, v.name);
  for (const v of everVehicles) if (!tipperIds.has(v.vehicleId)) tipperIds.set(v.vehicleId, v.vehicleLabel);
  return {
    loads,
    fleet: vehicles.map((v) => ({ id: v.id, name: v.name, tipper: v.tipper, set: v.set })),
    tippers: [...tipperIds].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    projects: projects.map((p) => ({ id: p.id, label: p.jobNo ? `${p.name} (${p.jobNo})` : p.name })),
    pickProjects: [...pickProjects].sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: `${p.jobNo ? `${p.name} (${p.jobNo})` : p.name}${p.status === "ACTIVE" ? "" : ` - ${p.status.toLowerCase()}`}` })),
    uses: TIPPER_USES.map((u) => ({ key: u.key, label: u.label })), contents: TIPPER_CONTENTS.map((c) => ({ ...c })),
    clientByJob: countProjects.map((p) => ({ projectId: p.id, project: p.name, jobNo: p.jobNo, client: p.client, loads: counts.get(p.id) ?? 0 }))
      .sort((a, b) => b.loads - a.loads || a.project.localeCompare(b.project)),
    range: { from: range.from, to: range.to },
  };
}

// ---------- the office's writes (Manager+ only; every change in RecordChange) ----------

const ctx = (by: Who, reason?: string | null) => ({ by, source: "Bins page (tipper loads)", reason: reason ?? null });

// A correction, a cancel, or the tip docket decision - one load.
export async function changeTipperLoad(idIn: unknown, body: Record<string, unknown>, by: Actor) {
  refuseAgent(by); // TL-003
  if (typeof idIn !== "string" || idIn.length > 64) throw new BinError("Unknown tipper load.", 404);
  const action = body.action;
  let becameClient = false;
  const out = await prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const l = await tx.tipperLoad.findUnique({ where: { id: idIn } });
    if (!l) throw new BinError("Unknown tipper load.", 404);
    if (l.status === "CANCELLED") throw new BinError("A cancelled load can't be changed.", 409);
    let data: Record<string, unknown>;
    let reason: string | null = null;
    if (action === "correct") {
      const c = parseTipperCorrection(body);
      if ("error" in c) throw new BinError(c.error);
      reason = c.reason;
      const f: Record<string, unknown> = { ...c.fields };
      if (c.fields.projectId && c.fields.projectId !== l.projectId) {
        // As bins (BN-003): a matched tip docket belongs to the job it was on - take it off first; never an archived job.
        if (l.tipReceiptId) throw new BinError("Take the tip docket off first.", 409);
        if (!(await tx.project.findFirst({ where: { id: c.fields.projectId, archived: false }, select: { id: true } }))) throw new BinError("Pick the job.");
      }
      if (c.fields.vehicleId && c.fields.vehicleId !== l.vehicleId) {
        const t = (await ourTippers()).find((v) => v.id === c.fields.vehicleId);
        if (!t) throw new BinError("Pick one of our tippers.");
        f.vehicleLabel = t.name.slice(0, 120);
        f.vehicleFromSignIn = false;
      }
      const contents = c.fields.contents ?? l.contents;
      const note = c.fields.contentsNote !== undefined ? c.fields.contentsNote : l.contentsNote;
      if (contents === "OTHER" && !note) throw new BinError("Say what's in it (Other).");
      if (Object.entries(c.fields).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v)) throw new BinError("Nothing to change.");
      data = f;
    } else if (action === "cancel") {
      reason = tidy(body.reason, 300);
      if (reason.length < 3) throw new BinError("Say why it's being cancelled.");
      if (!assertNoMoney(reason)) throw new BinError(NO_AMOUNT_REASON); // TL-004
      data = { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: byName(by).slice(0, 120), cancelReason: reason, tipReceiptId: null, tipConfirmedBy: null, tipConfirmedAt: null };
    } else if (action === "tip-confirm") {
      if (l.tipReceiptId) throw new BinError("This load already has a tip docket - take it off first.", 409);
      const rid = typeof body.receiptId === "string" ? body.receiptId.slice(0, 40) : "";
      const r = await tx.receipt.findUnique({ where: { id: rid }, select: { id: true, kind: true, status: true, projectId: true, sentAt: true, docketAt: true } });
      if (!r || r.kind !== "TIP" || r.status === "REJECTED") throw new BinError("Pick one of the tip dockets.");
      if (r.projectId !== l.projectId) throw new BinError("That docket is for another job.");
      if (!inWindow(loadAsPickUp(l), r, CONFIRM_WINDOW)) throw new BinError("That docket is too far from the load's date.");
      // One docket, one bin or load: checked across both under the same write lock.
      if (await tx.tipperLoad.findFirst({ where: { tipReceiptId: r.id, id: { not: l.id } }, select: { id: true } })) throw new BinError("That docket is already matched to another tipper load.", 409);
      if (await tx.binMovement.findFirst({ where: { tipReceiptId: r.id }, select: { id: true } })) throw new BinError("That docket is already matched to a bin.", 409);
      const rejected = rejectedOf(l.tipRejectedIds);
      data = { tipReceiptId: r.id, tipConfirmedBy: byName(by).slice(0, 120), tipConfirmedAt: new Date(), ...(rejected.includes(r.id) ? { tipRejectedIds: JSON.stringify(rejected.filter((x) => x !== r.id)) } : {}) };
    } else if (action === "tip-reject") {
      const rid = typeof body.receiptId === "string" ? body.receiptId.slice(0, 40) : "";
      if (!rid) throw new BinError("Which docket?");
      const list = rejectedOf(l.tipRejectedIds);
      if (list.includes(rid) && l.tipReceiptId !== rid) throw new BinError("Already marked as not this load's.", 409);
      data = { tipRejectedIds: JSON.stringify([...new Set([...list, rid])].slice(-50)), ...(l.tipReceiptId === rid ? { tipReceiptId: null, tipConfirmedBy: null, tipConfirmedAt: null } : {}) };
    } else throw new BinError("Unknown action.");
    // Conditional on the status read above - never overwrites a change made in between.
    const n = await tx.tipperLoad.updateMany({ where: { id: l.id, status: l.status }, data });
    if (n.count !== 1) throw new BinError("It changed while you were looking - reload and try again.", 409);
    const row = await tx.tipperLoad.findUniqueOrThrow({ where: { id: l.id } });
    await recordChanges(tx, "TipperLoad", l.id, l, row, ctx(by, reason), Object.keys(data));
    becameClient = l.use !== "CLIENT" && row.use === "CLIENT";
    return row;
  });
  // TL-005 (Ilies, 27 Nov 2026: "Yes, alert Alex"): corrected from our load to a client's load -> the same quiet alert as
  // a client's load from the phone, only after the change is saved; never holds up the reply.
  if (becameClient) void alertClientTipper(out.id).catch(() => {});
  return out;
}

// "Is this vehicle one of our tippers?" - yes or no, set by a Manager+ (owned, active vehicles only). Until the office
// sets it, it's from the vehicle's name. Kept in TipperVehicle (never deleted - set it the other way to undo); the
// change is in the vehicle's own history (Resource, field "tipper").
export async function setTipperFlag(vehicleIdIn: unknown, body: Record<string, unknown>, by: Actor) {
  refuseAgent(by); // TL-003
  if (typeof vehicleIdIn !== "string" || vehicleIdIn.length > 64) throw new BinError("Unknown vehicle.", 404);
  const input = parseTipperFlag(body);
  if ("error" in input) throw new BinError(input.error);
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const v = await tx.resource.findUnique({ where: { id: vehicleIdIn }, select: { id: true, name: true, type: true, ownership: true, active: true } });
    if (!v || v.type !== "VEHICLE") throw new BinError("Unknown vehicle.", 404);
    if (v.ownership !== "OWNED" || !v.active) throw new BinError("Only our own vehicles in use can be tippers.");
    const existing = await tx.tipperVehicle.findUnique({ where: { vehicleId: v.id } });
    const describe = (flag: boolean | null | undefined) => `${isTipper(v, flag) ? "yes" : "no"}${typeof flag === "boolean" ? "" : " (from its name)"}`;
    if (existing?.tipper === input.tipper) throw new BinError("Nothing to change.");
    const who = { setBy: byName(by).slice(0, 120), setById: by?.id ?? null, reason: input.reason };
    await tx.tipperVehicle.upsert({ where: { vehicleId: v.id }, create: { vehicleId: v.id, tipper: input.tipper, ...who }, update: { tipper: input.tipper, ...who } });
    await writeChanges(tx, "Resource", v.id, [{ field: "tipper", before: describe(existing?.tipper), after: describe(input.tipper) }], ctx(by, input.reason));
    return { id: v.id, tipper: input.tipper };
  });
}
