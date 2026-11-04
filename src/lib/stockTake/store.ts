// Yard Stage B - the stock take's database side (rules in ./rules.ts). Every register change goes through the ordinary
// tool paths: a condition through lib/toolUpdate.ts updateTool (as the tool form and the toolbox check's "Mark
// missing"), a move to the yard through lib/toolMoves.ts moveTool (logged, "held by" kept in step). Shelf photos are
// read by the toolbox check's reading (lib/toolVision.ts readToolboxPhotos - the existing Claude call, no new
// connection) and matched by its plain code (lib/toolboxCheck.ts compareToolbox, the yard as the box).
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { moveTool } from "../toolMoves";
import { updateTool, type ToolActor } from "../toolUpdate";
import { readToolboxPhotos } from "../toolVision";
import { compareToolbox } from "../toolboxCheck";
import { strippedTextWrite } from "../coordinatorHire";
import { seesAmountsStripped } from "../toolTextWrite";
import {
  ALREADY_OPEN, MAX_SCAN_PHOTOS, NOT_OPEN, SCAN_LIMIT, expectedFor, extraError, isMissingCandidate, lineChange, noteError, openKeyFor,
  planFinish, planScan, summarise, type CurrentTool, type Decisions, type LineAction,
} from "./rules";

export type Actor = ToolActor & { id: string | null };
type Fail = { error: string; status: number; undecided?: string[] };
const fail = (error: string, status: number, extra: Partial<Fail> = {}): Fail => ({ error, status, ...extra });

const TOOL_PICK = { id: true, tag: true, name: true, serialNumber: true, condition: true, toolboxId: true } as const;

// A note from the coordinator / yard goes through their amount rules (lib/coordinatorHire.ts strippedTextWrite).
function cleanNote(note: unknown, actor: Actor, stored?: string | null): { note: string | null } | { unchanged: true } | Fail {
  const bad = noteError(note);
  if (bad) return fail(bad, 400);
  const text = typeof note === "string" && note.trim() ? note.trim() : null;
  if (seesAmountsStripped(actor.role)) {
    const w = strippedTextWrite("notes", text, stored === undefined ? null : { stored });
    if (w === "unchanged") return { unchanged: true };
    if (w !== "ok") return fail(w.error, w.status);
  }
  return { note: text };
}

// ---------- reading ----------
export async function listStockTakes() {
  const takes = await prisma.stockTake.findMany({
    orderBy: { startedAt: "desc" }, take: 60,
    include: { lines: { select: { expected: true, result: true, conditionSeen: true, decision: true } } },
  });
  return takes.map(({ lines, ...s }) => ({ ...s, summary: summarise(lines) }));
}

export async function getStockTake(id: string) {
  const s = await prisma.stockTake.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: [{ expected: "desc" }, { tag: "asc" }],
        include: { tool: { select: { condition: true, toolboxId: true, toolbox: { select: { name: true } } } } },
      },
    },
  });
  if (!s) return null;
  const lines = s.lines.map(({ tool, ...l }) => ({
    ...l,
    now: tool ? { condition: tool.condition, place: tool.toolbox?.name ?? "Yard", inYard: tool.toolboxId === null } : null,
  }));
  return { ...s, lines, summary: summarise(lines), scansLeft: Math.max(0, SCAN_LIMIT - s.scans) };
}

const openOrFail = async (id: string) => {
  const s = await prisma.stockTake.findUnique({ where: { id }, select: { id: true, status: true, location: true, scans: true, note: true } });
  if (!s) return fail("That stock take isn't there.", 404);
  if (s.status !== "OPEN") return fail(NOT_OPEN, 409);
  return s;
};

// ---------- starting / cancelling ----------
export async function startStockTake(location: string, note: unknown, actor: Actor) {
  if (location !== "YARD") return fail("Only the yard can be counted for now.", 400);
  const n = cleanNote(note, actor);
  if ("error" in n) return n;
  const tools = expectedFor(location, await prisma.tool.findMany({ where: { toolboxId: null }, select: TOOL_PICK }));
  try {
    const s = await prisma.stockTake.create({
      data: {
        location, openKey: openKeyFor(location), note: "note" in n ? n.note : null,
        startedBy: actor.name, startedById: actor.id,
        lines: { create: tools.map((t) => ({ toolId: t.id, tag: t.tag, name: t.name, serialNumber: t.serialNumber, conditionAtStart: t.condition, expected: true })) },
      },
    });
    return { id: s.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(ALREADY_OPEN, 409);
    throw e;
  }
}

// Closes a stock take - nothing on the register changes (a move to the yard already tapped stays: it was its own step).
export async function cancelStockTake(id: string, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const r = await prisma.stockTake.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "CANCELLED", openKey: null, finishedAt: new Date(), finishedBy: actor.name, finishedById: actor.id },
  });
  return r.count ? { ok: true } : fail(NOT_OPEN, 409);
}

export async function setNote(id: string, note: unknown, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const n = cleanNote(note, actor, s.note);
  if ("error" in n) return n;
  if ("note" in n) await prisma.stockTake.update({ where: { id }, data: { note: n.note } });
  return { ok: true };
}

// ---------- ticking ----------
export async function lineAction(id: string, lineId: string, act: LineAction, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const line = await prisma.stockTakeLine.findFirst({ where: { id: lineId, stockTakeId: id } });
  if (!line) return fail("That tool isn't on this stock take.", 404);
  const out = lineChange(line, act);
  if ("error" in out) return fail(out.error, 400);
  const { patch } = out;
  await prisma.stockTakeLine.update({
    where: { id: lineId },
    data: { result: patch.result, conditionSeen: patch.conditionSeen, via: patch.via, checkedBy: patch.checked ? actor.name : null, checkedAt: patch.checked ? new Date() : null },
  });
  return { ok: true };
}

// A tool the register has somewhere else, found here - added by hand (from the register search).
export async function addExtra(id: string, toolId: string, conditionSeen: string | null, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const tool = await prisma.tool.findUnique({ where: { id: toolId }, select: { ...TOOL_PICK, toolbox: { select: { name: true } } } });
  const lines = await prisma.stockTakeLine.findMany({ where: { stockTakeId: id }, select: { id: true, toolId: true, tag: true, expected: true, result: true, conditionSeen: true, via: true } });
  const bad = extraError(tool, lines);
  if (bad || !tool) return fail(bad ?? "That tool isn't on the register.", bad?.includes("already") ? 409 : 400);
  const c = lineChange({ id: "", toolId, tag: tool.tag, expected: false, result: "EXTRA", conditionSeen: null, via: null }, { action: "CONDITION", conditionSeen });
  if ("error" in c) return fail(c.error, 400);
  const line = await prisma.stockTakeLine.create({
    data: {
      stockTakeId: id, toolId, tag: tool.tag, name: tool.name, serialNumber: tool.serialNumber, conditionAtStart: tool.condition, expected: false,
      registerPlace: tool.toolbox?.name ?? "the yard (added since the start)", result: "EXTRA", conditionSeen, via: "HAND", checkedBy: actor.name, checkedAt: new Date(),
    },
  });
  return { id: line.id };
}

// An EXTRA added by mistake: taken off again while the stock take is open (before anything about it was applied).
export async function dropExtra(id: string, lineId: string) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const line = await prisma.stockTakeLine.findFirst({ where: { id: lineId, stockTakeId: id } });
  if (!line) return fail("That tool isn't on this stock take.", 404);
  if (line.result !== "EXTRA") return fail("Only a tool added as found here can be dropped - untick the others.", 400);
  if (line.movedAt) return fail("It's already been moved to the yard on the register - move it back from the tool itself.", 409);
  await prisma.stockTakeLine.delete({ where: { id: lineId } });
  return { ok: true };
}

// "Move to yard": the register says it's in a toolbox, it's here. Only when the person taps it.
export async function moveExtraToYard(id: string, lineId: string, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const line = await prisma.stockTakeLine.findFirst({ where: { id: lineId, stockTakeId: id } });
  if (!line || !line.toolId) return fail("That tool isn't on this stock take (or on the register).", 404);
  if (line.result !== "EXTRA") return fail("Only a tool found here that the register has elsewhere can be moved.", 400);
  if (line.movedAt) return fail("It's already been moved to the yard.", 409);
  await moveTool(line.toolId, null, "Found in the yard on a stock take", actor.name);
  await prisma.stockTakeLine.update({ where: { id: lineId }, data: { movedAt: new Date() } });
  return { ok: true };
}

// ---------- a shelf photo ----------
export async function scanShelf(id: string, photoIds: unknown, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const ids = Array.isArray(photoIds) ? photoIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0 || ids.length > MAX_SCAN_PHOTOS) return fail(`Add 1 to ${MAX_SCAN_PHOTOS} photos of the shelf.`, 400);
  if (s.scans >= SCAN_LIMIT) return fail(`That's the most shelf photos one stock take can read (${SCAN_LIMIT}) - tick the rest by hand.`, 429);
  const photos = await prisma.toolPhoto.findMany({ where: { id: { in: ids }, kind: "CHECK" }, select: { id: true, fileName: true } });
  if (photos.length !== ids.length) return fail("One of the photos is missing - upload them again.", 400);
  const ordered = ids.map((pid) => photos.find((p) => p.id === pid)!);

  const reading = await readToolboxPhotos(ordered.map((p) => p.fileName)); // throws VisionNotConfigured -> 503 in the route
  await prisma.stockTake.update({ where: { id }, data: { scans: { increment: 1 } } });
  const tools = await prisma.tool.findMany({
    where: { condition: { not: "Swapped out" } },
    select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true, toolboxId: true, toolbox: { select: { name: true } } },
  });
  const result = compareToolbox(null, reading, tools.map(({ toolbox, condition: _c, ...t }) => ({ ...t, toolboxName: toolbox?.name ?? null })));
  const lines = await prisma.stockTakeLine.findMany({ where: { stockTakeId: id }, select: { id: true, toolId: true, tag: true, expected: true, result: true, conditionSeen: true, via: true } });
  const plan = planScan(lines, result);
  const now = new Date();
  if (plan.tick.length) {
    await prisma.stockTakeLine.updateMany({ where: { id: { in: plan.tick }, stockTakeId: id, result: { in: ["UNCHECKED", "NOT_FOUND"] } }, data: { result: "FOUND", via: "PHOTO", checkedBy: actor.name, checkedAt: now } });
  }
  const added: { lineId: string; tag: string; name: string; registerPlace: string | null }[] = [];
  for (const x of plan.extras) {
    try {
      const l = await prisma.stockTakeLine.create({
        data: {
          stockTakeId: id, toolId: x.toolId, tag: x.tag, name: x.name, serialNumber: x.serialNumber, expected: false,
          registerPlace: x.registerPlace ?? "the yard (added since the start)", result: "EXTRA", via: "PHOTO", checkedBy: actor.name, checkedAt: now,
          conditionAtStart: tools.find((t) => t.id === x.toolId)?.condition ?? null,
        },
      });
      added.push({ lineId: l.id, tag: x.tag, name: x.name, registerPlace: l.registerPlace });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // added meanwhile - fine
    }
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    ticked: plan.tick.map((lid) => ({ lineId: lid, tag: byId.get(lid)?.tag ?? "" })),
    alreadyFound: plan.alreadyFound.length,
    extras: added,
    probably: plan.probably,
    unknown: plan.unknown.map((u) => ({ description: u.description, brand: u.brand, model: u.model, lobTag: u.lobTag, serialNumber: u.serialNumber, possibly: u.possibly })),
    notes: plan.notes,
    scansLeft: Math.max(0, SCAN_LIMIT - s.scans - 1),
  };
}

// ---------- finishing ----------
export async function finishStockTake(id: string, d: Decisions, note: unknown, actor: Actor) {
  const s = await openOrFail(id);
  if ("error" in s) return s;
  const n = note === undefined ? ({ unchanged: true } as const) : cleanNote(note, actor, s.note);
  if ("error" in n) return n;
  const lines = await prisma.stockTakeLine.findMany({ where: { stockTakeId: id } });
  const tools = await prisma.tool.findMany({ where: { id: { in: lines.map((l) => l.toolId).filter((x): x is string => !!x) } }, select: { id: true, condition: true, toolboxId: true } });
  const current = new Map<string, CurrentTool>(tools.map((t) => [t.id, { condition: t.condition, toolboxId: t.toolboxId }]));
  const plan = planFinish(lines, current, d);
  if ("error" in plan) return fail(plan.error, 409, { undecided: plan.undecided });

  // One line at a time through the ordinary tool update; each line records what it did, so a finish interrupted
  // half-way can simply be pressed again (lines already applied are skipped).
  const done: { lineId: string; change: string }[] = [];
  for (const step of plan.steps) {
    const line = lines.find((l) => l.id === step.lineId)!;
    const data: Prisma.StockTakeLineUpdateInput = {};
    if (step.decision && line.decision !== step.decision) data.decision = step.decision;
    if (step.condition && line.toolId) {
      const out = await updateTool(line.toolId, { condition: step.condition }, actor);
      if ("error" in out) return fail(`${line.tag}: ${out.error}`, out.status);
      data.appliedAt = new Date();
      data.appliedChange = step.change;
      done.push({ lineId: line.id, change: `${line.tag}: ${step.change}` });
    } else if (step.note && !line.appliedAt && step.note !== "Already applied") data.appliedChange = step.note;
    if (Object.keys(data).length) await prisma.stockTakeLine.update({ where: { id: line.id }, data });
  }
  const r = await prisma.stockTake.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "FINISHED", openKey: null, finishedAt: new Date(), finishedBy: actor.name, finishedById: actor.id, ...("note" in n ? { note: n.note } : {}) },
  });
  if (!r.count) return fail(NOT_OPEN, 409);
  const after = await prisma.stockTakeLine.findMany({ where: { stockTakeId: id }, select: { expected: true, result: true, conditionSeen: true, decision: true } });
  return { ok: true, changes: done, summary: summarise(after), candidates: lines.filter(isMissingCandidate).length };
}
