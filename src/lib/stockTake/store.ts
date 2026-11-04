// Yard Stage B - the stock take's database side (rules in ./rules.ts). Every register change goes through the ordinary
// tool paths: a condition through lib/toolUpdate.ts updateTool (as the tool form and the toolbox check's "Mark
// missing"), a move to the yard through lib/toolMoves.ts moveTool (logged, "held by" kept in step). Shelf photos are
// read by the toolbox check's reading (lib/toolVision.ts readToolboxPhotos - the existing Claude call, no new
// connection) and matched by its plain code (lib/toolboxCheck.ts compareToolbox, the yard as the box).
// ST-001 (Ilies approved 4 Nov 2026): every line write is conditional on the stock take still being OPEN, in the same
// statement or transaction as the write - a slow photo reading or a late tap can never land on a stock take a finish
// has claimed. Finishing claims the stock take first (OPEN -> FINISHING), applies each line once (its own claim on
// appliedAt), then FINISHING -> FINISHED. `deps` lets `npm test` run these against a stand-in database.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { moveTool } from "../toolMoves";
import { updateTool, type ToolActor } from "../toolUpdate";
import { readToolboxPhotos } from "../toolVision";
import { compareToolbox } from "../toolboxCheck";
import { strippedTextWrite } from "../coordinatorHire";
import { seesAmountsStripped } from "../toolTextWrite";
import {
  ALREADY_APPLIED, ALREADY_OPEN, CANT_CANCEL_FINISHING, DAILY_SCAN_LIMIT, DAILY_SCAN_LIMIT_HIT, FINISH_LEASE_MS, FINISH_RUNNING, MAX_SCAN_PHOTOS,
  NOT_OPEN, SCAN_LIMIT, SCAN_LIMIT_HIT, closedMessage, expectedFor, sydneyDay,
  extraError, isMissingCandidate, isOpenish, lineChange, noteError, openKeyFor, planFinish, planScan, summarise,
  type CurrentTool, type Decisions, type LineAction,
} from "./rules";

export type Actor = ToolActor & { id: string | null };
type Fail = { error: string; status: number; undecided?: string[] };
const fail = (error: string, status: number, extra: Partial<Fail> = {}): Fail => ({ error, status, ...extra });

type Db = typeof prisma;
export type Deps = { db: Db; apply: typeof updateTool; move: typeof moveTool; read: typeof readToolboxPhotos };
const REAL: Deps = { db: prisma, apply: updateTool, move: moveTool, read: readToolboxPhotos };

const TOOL_PICK = { id: true, tag: true, name: true, serialNumber: true, condition: true, toolboxId: true } as const;
const LINE_PICK = { id: true, toolId: true, tag: true, expected: true, result: true, conditionSeen: true, via: true, movedAt: true, appliedAt: true } as const;

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
export async function listStockTakes(deps: Deps = REAL) {
  const takes = await deps.db.stockTake.findMany({
    orderBy: { startedAt: "desc" }, take: 60,
    include: { lines: { select: { expected: true, result: true, conditionSeen: true, decision: true, appliedAt: true, appliedChange: true } } }, // ST-006
  });
  return takes.map(({ lines, startedById: _a, finishedById: _b, ...s }) => ({ ...s, summary: summarise(lines) })); // ST-005: no login ids out
}

export async function getStockTake(id: string, deps: Deps = REAL) {
  const s = await deps.db.stockTake.findUnique({
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
  const { startedById: _a, finishedById: _b, ...shown } = s; // ST-005 (Ilies approved 4 Nov 2026): no login ids out
  return { ...shown, lines, summary: summarise(lines), scansLeft: Math.max(0, SCAN_LIMIT - s.scans) };
}

// The stock take, or why a change to it is refused (404, or 409 once it isn't OPEN).
async function openOrFail(id: string, db: Db) {
  const s = await db.stockTake.findUnique({ where: { id }, select: { id: true, status: true, location: true, scans: true, note: true } });
  if (!s) return fail("That stock take isn't there.", 404);
  if (s.status !== "OPEN") return fail(closedMessage(s.status), 409);
  return s;
}
// After a conditional write matched nothing: why (the stock take moved on, or the line did).
async function whyNot(id: string, db: Db, lineMessage: string) {
  const s = await db.stockTake.findUnique({ where: { id }, select: { status: true } });
  return s && s.status !== "OPEN" ? fail(closedMessage(s.status), 409) : fail(lineMessage, 409);
}

// Runs `fn` only while the stock take is OPEN, in one transaction that first writes to the stock take row (a no-op
// update, conditional on OPEN). That write takes the database's write lock, so a finish's claim (OPEN -> FINISHING)
// lands either before (fn never runs: 409) or after this commits (and then the finish sees what fn wrote).
class StockTakeNotOpen extends Error {}
async function whileOpen<T>(id: string, db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | Fail> {
  try {
    return await db.$transaction(async (tx) => {
      const held = await tx.stockTake.updateMany({ where: { id, status: "OPEN" }, data: { status: "OPEN" } });
      if (!held.count) throw new StockTakeNotOpen();
      return fn(tx);
    });
  } catch (e) {
    if (e instanceof StockTakeNotOpen) {
      const s = await db.stockTake.findUnique({ where: { id }, select: { status: true } });
      return s ? fail(closedMessage(s.status), 409) : fail("That stock take isn't there.", 404);
    }
    throw e;
  }
}
const isFail = (x: unknown): x is Fail => !!x && typeof x === "object" && "error" in x && "status" in x;

// ---------- starting / cancelling ----------
export async function startStockTake(location: string, note: unknown, actor: Actor, deps: Deps = REAL) {
  if (location !== "YARD") return fail("Only the yard can be counted for now.", 400);
  const n = cleanNote(note, actor);
  if ("error" in n) return n;
  const tools = expectedFor(location, await deps.db.tool.findMany({ where: { toolboxId: null }, select: TOOL_PICK }));
  try {
    const s = await deps.db.stockTake.create({
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
// Never while a finish holds it (ST-001).
export async function cancelStockTake(id: string, actor: Actor, deps: Deps = REAL) {
  const r = await deps.db.stockTake.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "CANCELLED", openKey: null, finishedAt: new Date(), finishedBy: actor.name, finishedById: actor.id },
  });
  if (r.count) return { ok: true };
  const s = await deps.db.stockTake.findUnique({ where: { id }, select: { status: true } });
  if (!s) return fail("That stock take isn't there.", 404);
  return fail(s.status === "FINISHING" ? CANT_CANCEL_FINISHING : NOT_OPEN, 409);
}

export async function setNote(id: string, note: unknown, actor: Actor, deps: Deps = REAL) {
  const s = await openOrFail(id, deps.db);
  if ("error" in s) return s;
  const n = cleanNote(note, actor, s.note);
  if ("error" in n) return n;
  if ("note" in n) {
    const r = await deps.db.stockTake.updateMany({ where: { id, status: "OPEN" }, data: { note: n.note } });
    if (!r.count) return whyNot(id, deps.db, NOT_OPEN);
  }
  return { ok: true };
}

// ---------- ticking ----------
export async function lineAction(id: string, lineId: string, act: LineAction, actor: Actor, deps: Deps = REAL) {
  const s = await openOrFail(id, deps.db);
  if ("error" in s) return s;
  const line = await deps.db.stockTakeLine.findFirst({ where: { id: lineId, stockTakeId: id }, select: LINE_PICK });
  if (!line) return fail("That tool isn't on this stock take.", 404);
  const out = lineChange(line, act);
  if ("error" in out) return fail(out.error, out.status ?? 400);
  const { patch } = out;
  const r = await deps.db.stockTakeLine.updateMany({
    where: { id: lineId, stockTakeId: id, appliedAt: null, stockTake: { status: "OPEN" } },
    data: { result: patch.result, conditionSeen: patch.conditionSeen, via: patch.via, checkedBy: patch.checked ? actor.name : null, checkedAt: patch.checked ? new Date() : null },
  });
  if (!r.count) return whyNot(id, deps.db, "It changed - reload.");
  return { ok: true };
}

// A tool the register has somewhere else, found here - added by hand (from the register search).
export async function addExtra(id: string, toolId: string, conditionSeen: string | null, actor: Actor, deps: Deps = REAL) {
  const s = await openOrFail(id, deps.db);
  if ("error" in s) return s;
  const tool = await deps.db.tool.findUnique({ where: { id: toolId }, select: { ...TOOL_PICK, toolbox: { select: { name: true } } } });
  const lines = await deps.db.stockTakeLine.findMany({ where: { stockTakeId: id }, select: LINE_PICK });
  const bad = extraError(tool, lines);
  if (bad || !tool) return fail(bad ?? "That tool isn't on the register.", bad?.includes("already") ? 409 : 400);
  const c = lineChange({ id: "", toolId, tag: tool.tag, expected: false, result: "EXTRA", conditionSeen: null, via: null }, { action: "CONDITION", conditionSeen });
  if ("error" in c) return fail(c.error, 400);
  const fields = {
    tag: tool.tag, name: tool.name, serialNumber: tool.serialNumber, conditionAtStart: tool.condition,
    registerPlace: tool.toolbox?.name ?? "the yard (added since the start)", result: "EXTRA", conditionSeen, via: "HAND", checkedBy: actor.name, checkedAt: new Date(),
  };
  const dropped = lines.find((l) => l.toolId === toolId && l.result === "DROPPED");
  try {
    const out = await whileOpen(id, deps.db, async (tx) => {
      // ST-005: a tool dropped by mistake earlier is added back on its own line (kept, never deleted).
      if (dropped) {
        const r = await tx.stockTakeLine.updateMany({ where: { id: dropped.id, result: "DROPPED", appliedAt: null }, data: fields });
        return r.count ? { id: dropped.id } : fail("It changed - reload.", 409);
      }
      return tx.stockTakeLine.create({ data: { stockTakeId: id, toolId, expected: false, ...fields } });
    });
    if (isFail(out)) return out;
    return { id: out.id };
  } catch (e) {
    // ST-005 (Ilies approved 4 Nov 2026): added at the same moment by someone else (or a shelf photo).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("That tool is already on this stock take.", 409);
    throw e;
  }
}

// An EXTRA added by mistake: taken off again while the stock take is open (before anything about it was applied).
// ST-005 (Ilies approved 4 Nov 2026): kept as DROPPED - out of every count and list, never deleted.
export async function dropExtra(id: string, lineId: string, deps: Deps = REAL) {
  const s = await openOrFail(id, deps.db);
  if ("error" in s) return s;
  const line = await deps.db.stockTakeLine.findFirst({ where: { id: lineId, stockTakeId: id }, select: LINE_PICK });
  if (!line) return fail("That tool isn't on this stock take.", 404);
  if (line.appliedAt) return fail(ALREADY_APPLIED, 409);
  if (line.result !== "EXTRA") return fail("Only a tool added as found here can be dropped - untick the others.", 400);
  if (line.movedAt) return fail("It's already been moved to the yard on the register - move it back from the tool itself.", 409);
  const r = await deps.db.stockTakeLine.updateMany({
    where: { id: lineId, stockTakeId: id, result: "EXTRA", movedAt: null, appliedAt: null, stockTake: { status: "OPEN" } },
    data: { result: "DROPPED", conditionSeen: null },
  });
  if (!r.count) return whyNot(id, deps.db, "It changed - reload.");
  return { ok: true };
}

// "Move to yard": the register says it's in a toolbox, it's here. Only when the person taps it. The line is claimed
// first (movedAt, conditional on the stock take being OPEN), then moveTool; if the move fails the claim is undone.
export async function moveExtraToYard(id: string, lineId: string, actor: Actor, deps: Deps = REAL) {
  const s = await openOrFail(id, deps.db);
  if ("error" in s) return s;
  const line = await deps.db.stockTakeLine.findFirst({ where: { id: lineId, stockTakeId: id }, select: LINE_PICK });
  if (!line || !line.toolId) return fail("That tool isn't on this stock take (or on the register).", 404);
  if (line.result !== "EXTRA") return fail("Only a tool found here that the register has elsewhere can be moved.", 400);
  if (line.movedAt) return fail("It's already been moved to the yard.", 409);
  const claimed = await deps.db.stockTakeLine.updateMany({
    where: { id: lineId, stockTakeId: id, result: "EXTRA", movedAt: null, appliedAt: null, stockTake: { status: "OPEN" } },
    data: { movedAt: new Date() },
  });
  if (!claimed.count) return whyNot(id, deps.db, "It's already been moved to the yard.");
  try {
    await deps.move(line.toolId, null, "Found in the yard on a stock take", actor.name);
  } catch (e) {
    await deps.db.stockTakeLine.updateMany({ where: { id: lineId }, data: { movedAt: null } });
    throw e;
  }
  return { ok: true };
}

// ---------- a shelf photo ----------
class ReadingRefused extends Error { constructor(readonly why: "take" | "day") { super(why); } }
async function reserveReading(id: string, photos: number, actor: Actor, db: Db): Promise<{ scans: number } | Fail> {
  const day = sydneyDay(new Date());
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.stockTake.updateMany({ where: { id, status: "OPEN", scans: { lt: SCAN_LIMIT } }, data: { scans: { increment: 1 } } });
      if (!r.count) throw new ReadingRefused("take");
      if ((await tx.stockTakeScan.count({ where: { day } })) >= DAILY_SCAN_LIMIT) throw new ReadingRefused("day");
      await tx.stockTakeScan.create({ data: { stockTakeId: id, day, by: actor.name, photos } });
      const now = await tx.stockTake.findUnique({ where: { id }, select: { scans: true } });
      return { scans: now?.scans ?? SCAN_LIMIT };
    });
  } catch (e) {
    if (!(e instanceof ReadingRefused)) throw e;
    if (e.why === "day") return fail(DAILY_SCAN_LIMIT_HIT, 429);
    const s = await db.stockTake.findUnique({ where: { id }, select: { status: true } });
    return s?.status === "OPEN" ? fail(SCAN_LIMIT_HIT, 429) : fail(closedMessage(s?.status), 409);
  }
}
export async function scanShelf(id: string, photoIds: unknown, actor: Actor, deps: Deps = REAL) {
  const { db } = deps;
  const s = await openOrFail(id, db);
  if ("error" in s) return s;
  const ids = Array.isArray(photoIds) ? photoIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0 || ids.length > MAX_SCAN_PHOTOS) return fail(`Add 1 to ${MAX_SCAN_PHOTOS} photos of the shelf.`, 400);
  if (s.scans >= SCAN_LIMIT) return fail(SCAN_LIMIT_HIT, 429);
  const photos = await db.toolPhoto.findMany({ where: { id: { in: ids }, kind: "CHECK" }, select: { id: true, fileName: true } });
  if (photos.length !== ids.length) return fail("One of the photos is missing - upload them again.", 400);
  const ordered = ids.map((pid) => photos.find((p) => p.id === pid)!);

  // ST-002 (Ilies approved 4 Nov 2026): the reading is reserved before the Claude call, in one transaction - this
  // stock take's count goes up only while it's OPEN and under SCAN_LIMIT, and today's readings across every stock
  // take must be under DAILY_SCAN_LIMIT (the stock take row is written first, so two scans can't both take the last
  // place). A reading that then fails isn't given back: it may have been charged.
  const reserved = await reserveReading(id, ids.length, actor, db);
  if (isFail(reserved)) return reserved;
  const reading = await deps.read(ordered.map((p) => p.fileName)); // throws VisionNotConfigured -> 503 in the route
  const tools = await db.tool.findMany({
    where: { condition: { not: "Swapped out" } },
    select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true, toolboxId: true, toolbox: { select: { name: true } } },
  });
  const result = compareToolbox(null, reading, tools.map(({ toolbox, condition: _c, ...t }) => ({ ...t, toolboxName: toolbox?.name ?? null })));

  // ST-001: the reading may have taken a while - everything it writes happens only if the stock take is still OPEN.
  const out = await whileOpen(id, db, async (tx) => {
    const lines = await tx.stockTakeLine.findMany({ where: { stockTakeId: id }, select: LINE_PICK });
    const plan = planScan(lines, result);
    const now = new Date();
    if (plan.tick.length) {
      await tx.stockTakeLine.updateMany({ where: { id: { in: plan.tick }, stockTakeId: id, appliedAt: null, result: { in: ["UNCHECKED", "NOT_FOUND"] } }, data: { result: "FOUND", via: "PHOTO", checkedBy: actor.name, checkedAt: now } });
    }
    const added: { lineId: string; tag: string; name: string; registerPlace: string | null }[] = [];
    for (const x of plan.extras) {
      if (lines.some((l) => l.toolId === x.toolId)) continue;
      const l = await tx.stockTakeLine.create({
        data: {
          stockTakeId: id, toolId: x.toolId, tag: x.tag, name: x.name, serialNumber: x.serialNumber, expected: false,
          registerPlace: x.registerPlace ?? "the yard (added since the start)", result: "EXTRA", via: "PHOTO", checkedBy: actor.name, checkedAt: now,
          conditionAtStart: tools.find((t) => t.id === x.toolId)?.condition ?? null,
        },
      });
      added.push({ lineId: l.id, tag: x.tag, name: x.name, registerPlace: l.registerPlace });
    }
    const byId = new Map(lines.map((l) => [l.id, l]));
    return { plan, added, byId };
  });
  if (isFail(out)) return out;
  const { plan, added, byId } = out;
  return {
    ticked: plan.tick.map((lid) => ({ lineId: lid, tag: byId.get(lid)?.tag ?? "" })),
    alreadyFound: plan.alreadyFound.length,
    extras: added,
    probably: plan.probably,
    unknown: plan.unknown.map((u) => ({ description: u.description, brand: u.brand, model: u.model, lobTag: u.lobTag, serialNumber: u.serialNumber, possibly: u.possibly })),
    notes: plan.notes,
    scansLeft: Math.max(0, SCAN_LIMIT - reserved.scans),
  };
}

// ---------- finishing ----------
// ST-001 (Ilies approved 4 Nov 2026): checked first (nothing is claimed for a finish that would be refused), then
// claimed - OPEN -> FINISHING, or a FINISHING one whose last finish stopped (no running claim, or one older than
// FINISH_LEASE_MS) - so two Finish presses can't both run: one goes ahead, the other gets 409. Each line is applied at
// most once (claimed on appliedAt before its tool is changed). A step that fails leaves it FINISHING with the claim
// released, and pressing Finish again carries on from where it stopped. Last: FINISHING -> FINISHED, openKey freed.
export async function finishStockTake(id: string, d: Decisions, note: unknown, actor: Actor, deps: Deps = REAL) {
  const { db } = deps;
  const s = await db.stockTake.findUnique({ where: { id }, select: { status: true, note: true } });
  if (!s) return fail("That stock take isn't there.", 404);
  if (!isOpenish(s.status)) return fail(NOT_OPEN, 409);
  const n = note === undefined ? ({ unchanged: true } as const) : cleanNote(note, actor, s.note);
  if ("error" in n) return n;

  const load = async () => {
    const lines = await db.stockTakeLine.findMany({ where: { stockTakeId: id } });
    const tools = await db.tool.findMany({ where: { id: { in: lines.map((l) => l.toolId).filter((x): x is string => !!x) } }, select: { id: true, condition: true, toolboxId: true } });
    const current = new Map<string, CurrentTool>(tools.map((t) => [t.id, { condition: t.condition, toolboxId: t.toolboxId }]));
    return { lines, current };
  };
  const first = await load();
  // ST-005 (Ilies approved 4 Nov 2026): never more decisions than the stock take has lines.
  if (d.missing.length > first.lines.length || d.leave.length > first.lines.length) return fail("Too many tools in that finish - reload and try again.", 400);
  const check = planFinish(first.lines, first.current, d);
  if ("error" in check) return fail(check.error, 409, { undecided: check.undecided });

  // The claim.
  const leaseAt = new Date();
  const claimed = s.status === "OPEN"
    ? await db.stockTake.updateMany({ where: { id, status: "OPEN" }, data: { status: "FINISHING", finishedAt: leaseAt } })
    : await db.stockTake.updateMany({
      where: { id, status: "FINISHING", OR: [{ finishedAt: null }, { finishedAt: { lt: new Date(leaseAt.getTime() - FINISH_LEASE_MS) } }] },
      data: { finishedAt: leaseAt },
    });
  if (!claimed.count) {
    const now = await db.stockTake.findUnique({ where: { id }, select: { status: true } });
    return fail(now?.status === "FINISHING" ? FINISH_RUNNING : NOT_OPEN, 409);
  }
  const release = (back: "OPEN" | "FINISHING") => db.stockTake.updateMany({ where: { id, status: "FINISHING", finishedAt: leaseAt }, data: { status: back, finishedAt: null } });

  // Planned again on what's there now it's held (a tick may have landed between the check and the claim).
  const { lines, current } = await load();
  const plan = planFinish(lines, current, d);
  if ("error" in plan) {
    await release(s.status === "OPEN" && !lines.some((l) => l.appliedAt) ? "OPEN" : "FINISHING");
    return fail(plan.error, 409, { undecided: plan.undecided });
  }

  // One line at a time through the ordinary tool update; each records what it did.
  const done: { lineId: string; change: string }[] = [];
  for (const step of plan.steps) {
    const line = lines.find((l) => l.id === step.lineId)!;
    if (line.appliedAt) continue;
    if (step.condition && line.toolId) {
      const mine = await db.stockTakeLine.updateMany({
        where: { id: line.id, appliedAt: null },
        data: { appliedAt: new Date(), appliedChange: step.change, ...(step.decision ? { decision: step.decision } : {}) },
      });
      if (!mine.count) continue; // applied by another finish
      // ST-006 (Ilies approved 4 Nov 2026): a tool update that throws (not just one that answers an error) also hands
      // the line back - not applied - and leaves the stock take FINISHING with the claim released, so Finish resumes it.
      let out: Awaited<ReturnType<Deps["apply"]>>;
      try {
        out = await deps.apply(line.toolId, { condition: step.condition }, actor);
      } catch (e) {
        await db.stockTakeLine.updateMany({ where: { id: line.id }, data: { appliedAt: null, appliedChange: null } });
        await release("FINISHING");
        throw e;
      }
      if ("error" in out) {
        await db.stockTakeLine.updateMany({ where: { id: line.id }, data: { appliedAt: null, appliedChange: null } });
        await release("FINISHING");
        return fail(`${line.tag}: ${out.error}`, out.status);
      }
      done.push({ lineId: line.id, change: `${line.tag}: ${step.change}` });
    } else {
      const data: Prisma.StockTakeLineUpdateManyMutationInput = {};
      if (step.decision && line.decision !== step.decision) data.decision = step.decision;
      if (step.note && step.note !== "Already applied") data.appliedChange = step.note;
      if (Object.keys(data).length) await db.stockTakeLine.updateMany({ where: { id: line.id, appliedAt: null }, data });
    }
  }
  const r = await db.stockTake.updateMany({
    where: { id, status: "FINISHING", finishedAt: leaseAt },
    data: { status: "FINISHED", openKey: null, finishedAt: new Date(), finishedBy: actor.name, finishedById: actor.id, ...("note" in n ? { note: n.note } : {}) },
  });
  if (!r.count) return fail(FINISH_RUNNING, 409);
  const after = await db.stockTakeLine.findMany({ where: { stockTakeId: id }, select: { expected: true, result: true, conditionSeen: true, decision: true, appliedAt: true, appliedChange: true } });
  return { ok: true, changes: done, summary: summarise(after), candidates: lines.filter(isMissingCandidate).length };
}
