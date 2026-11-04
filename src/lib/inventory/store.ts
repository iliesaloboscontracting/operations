// Consumables inventory (Yard Stage C, Ilies 4 Nov 2026) - server side: the item list, adding / editing / retiring an
// item, stock in / out / counts, a yard job taking from stock, and the one "below minimum" alert to the Admins.
// onHand only ever changes together with its StockMovement row, in one transaction, and only from the value that was
// read (someone else changed it in between -> 409, nothing written). Quantities only - no price anywhere. The guard
// (who may look / write) is the route's job (lib/auth.ts guardTools).
import type { InventoryItem, Prisma, StockMovement } from "@prisma/client";
import { prisma } from "../prisma";
import { pushToAdmins } from "../push";
import { requestNo } from "../requestTypes";
import { todaySydney } from "../today";
import {
  CATEGORY_LABEL, NO_AMOUNTS, STATUS_LABEL, belowMinStep, fmtQty, hasAmount, itemFields, planMovement, stockStatus,
  type Category, type MoveKind,
} from "./rules";

export type Actor = { id: string | null; name: string; role?: string };

// The sites "Stock out to a site" offers - id and name only. CI-001 option (b) (Ilies approved 4 Nov 2026): the yard
// computer only gets the projects on the board (a Job) from 7 days before to 7 days after today, Sydney time - not
// the whole project list; Managers / Admins / the coordinator get every active project.
export const YARD_SITE_WINDOW_DAYS = 7;
export async function inventorySites(role: string): Promise<{ id: string; name: string }[]> {
  if (role !== "YARD") return prisma.project.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const today = new Date(todaySydney() + "T00:00:00.000Z");
  const from = new Date(today.getTime() - YARD_SITE_WINDOW_DAYS * 86_400_000);
  const to = new Date(today.getTime() + (YARD_SITE_WINDOW_DAYS + 1) * 86_400_000);
  return prisma.project.findMany({ where: { jobs: { some: { date: { gte: from, lt: to } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
export type Fail = { error: string; status: number };
export const CHANGED: Fail = { error: "It changed - reload the list.", status: 409 };
// Thrown inside a transaction so everything in it is rolled back.
export class StockError extends Error {
  constructor(public fail: Fail) { super(fail.error); }
}

export function itemView(i: InventoryItem & { movements?: Pick<StockMovement, "at">[] }) {
  const status = stockStatus(i);
  return {
    id: i.id, name: i.name, category: i.category, categoryLabel: CATEGORY_LABEL[i.category as Category] ?? i.category,
    unit: i.unit, minLevel: i.minLevel, location: i.location, onHand: i.onHand, active: i.active,
    status, statusLabel: STATUS_LABEL[status], createdAt: i.createdAt.toISOString(), createdBy: i.createdBy,
    lastMovementAt: i.movements?.[0]?.at.toISOString() ?? null,
  };
}
export type ItemView = ReturnType<typeof itemView>;

export async function listItems(includeRetired = false) {
  const rows = await prisma.inventoryItem.findMany({
    where: includeRetired ? {} : { active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { movements: { orderBy: { at: "desc" }, take: 1, select: { at: true } } },
    take: 1000,
  });
  return rows.map(itemView);
}
export const belowMinCount = async () => (await prisma.inventoryItem.findMany({ where: { active: true, minLevel: { not: null } }, select: { onHand: true, minLevel: true } }))
  .filter((i) => stockStatus(i) === "BELOW").length;

// Active names are unique, any case - two "P2 masks" would split the stock.
async function nameTaken(name: string, exceptId?: string) {
  const rows = await prisma.inventoryItem.findMany({ where: { active: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  return rows.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
}
const NAME_TAKEN = "There's already an item with that name - use that one, or name this one differently.";

export async function createItem(body: Record<string, unknown>, actor: Actor): Promise<{ item: ItemView } | Fail> {
  const f = itemFields(body);
  if ("error" in f) return { error: f.error, status: 400 };
  const d = f.data as Required<typeof f.data>;
  if (await nameTaken(d.name)) return { error: NAME_TAKEN, status: 400 };
  // An optional first count, recorded as a COUNT movement ("First count") so the history starts at the shelf.
  const opening = body.openingQty === undefined || body.openingQty === null || body.openingQty === "" ? null : planMovement(0, d.unit, "COUNT", body.openingQty);
  if (opening && "error" in opening) return { error: opening.error, status: 400 };
  const item = await prisma.$transaction(async (tx) => {
    const it = await tx.inventoryItem.create({
      data: { name: d.name, category: d.category, unit: d.unit, minLevel: d.minLevel, location: d.location, onHand: opening?.balanceAfter ?? 0, createdBy: actor.name, createdById: actor.id },
    });
    if (opening) await tx.stockMovement.create({ data: { itemId: it.id, kind: "COUNT", change: opening.change, balanceAfter: opening.balanceAfter, countedQty: opening.countedQty, reason: "First count", by: actor.name, byUserId: actor.id } });
    return it;
  });
  await afterStockChange([item.id]);
  return { item: itemView((await prisma.inventoryItem.findUnique({ where: { id: item.id } }))!) };
}

// Edit the fields, or retire (active false) / bring back (active true). Never deleted - the history stays.
export async function updateItem(id: string, body: Record<string, unknown>, _actor: Actor): Promise<{ item: ItemView } | Fail> {
  const it = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!it) return { error: "Not found.", status: 404 };
  const f = itemFields(body, true);
  if ("error" in f) return { error: f.error, status: 400 };
  const data: Prisma.InventoryItemUpdateInput = { ...f.data };
  if ("onHand" in body) return { error: "Change the quantity with stock in, stock out or a count - so it's recorded.", status: 400 };
  if (body.active !== undefined) data.active = Boolean(body.active);
  const active = data.active ?? it.active;
  const name = (f.data.name ?? it.name) as string;
  if (active && (f.data.name !== undefined || (data.active === true && !it.active)) && (await nameTaken(name, id))) return { error: NAME_TAKEN, status: 400 };
  await prisma.inventoryItem.update({ where: { id }, data });
  await afterStockChange([id]); // a new minimum, or a retired item, can start or end "below minimum"
  return { item: itemView((await prisma.inventoryItem.findUnique({ where: { id } }))!) };
}

type MoveCtx = { reason?: unknown; siteRequestId?: string | null; projectId?: string | null; siteLabel?: string | null };
const reasonText = (x: unknown) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 200) : "") || null;

// One movement inside a transaction: re-read the item, plan, move onHand only from the value read, record the row.
async function moveInTx(tx: Prisma.TransactionClient, itemId: string, kind: MoveKind, qty: unknown, actor: Actor, ctx: MoveCtx) {
  const it = await tx.inventoryItem.findUnique({ where: { id: itemId } });
  if (!it) throw new StockError({ error: "That item isn't in the inventory.", status: 404 });
  if (!it.active) throw new StockError({ error: `${it.name} has been retired - bring it back first.`, status: 409 });
  const plan = planMovement(it.onHand, it.unit, kind, qty);
  if ("error" in plan) throw new StockError({ error: plan.error, status: 400 });
  const { count } = await tx.inventoryItem.updateMany({ where: { id: it.id, onHand: it.onHand }, data: { onHand: plan.balanceAfter } });
  if (!count) throw new StockError(CHANGED);
  return tx.stockMovement.create({
    data: {
      itemId: it.id, kind, change: plan.change, balanceAfter: plan.balanceAfter, countedQty: plan.countedQty, reason: reasonText(ctx.reason),
      siteRequestId: ctx.siteRequestId ?? null, projectId: ctx.projectId ?? null, siteLabel: ctx.siteLabel ?? null, by: actor.name, byUserId: actor.id,
    },
  });
}

// Stock in, stock out (optionally to a site) or a count, from /yard/inventory.
export async function recordMovement(itemId: string, body: Record<string, unknown>, actor: Actor): Promise<{ item: ItemView } | Fail> {
  const kind = String(body.kind) as MoveKind;
  if (!["IN", "OUT", "COUNT"].includes(kind)) return { error: "Stock in, stock out or a count.", status: 400 };
  if (hasAmount(reasonText(body.reason))) return { error: NO_AMOUNTS, status: 400 };
  let site: { id: string; name: string } | null = null;
  if (kind === "OUT" && body.projectId !== undefined && body.projectId !== null && body.projectId !== "") {
    // Only a site the person was offered (CI-001b: the yard computer's are the week either side of today).
    site = typeof body.projectId === "string" && body.projectId.length <= 40
      ? (await inventorySites(actor.role ?? "")).find((s) => s.id === body.projectId) ?? null
      : null;
    if (!site) return { error: "Pick the site.", status: 400 };
  }
  try {
    await prisma.$transaction((tx) => moveInTx(tx, itemId, kind, kind === "COUNT" ? (body.countedQty ?? body.qty) : body.qty, actor, { reason: body.reason, projectId: site?.id, siteLabel: site?.name }));
  } catch (e) {
    if (e instanceof StockError) return e.fail;
    throw e;
  }
  await afterStockChange([itemId]);
  return { item: itemView((await prisma.inventoryItem.findUnique({ where: { id: itemId } }))!) };
}

// A yard job's "Took from stock", inside the READY transaction (lib/yard/store.ts): an OUT per line, tied to the
// request and its site. Any problem throws, so the READY move and every line roll back together.
export async function takeForYardJob(tx: Prisma.TransactionClient, lines: { itemId: string; qty: number }[], job: { id: string; number: number; projectId: string | null; siteLabel: string }, actor: Actor) {
  for (const l of lines) await moveInTx(tx, l.itemId, "OUT", l.qty, actor, { reason: `With ${requestNo(job.number)}`, siteRequestId: job.id, projectId: job.projectId, siteLabel: job.siteLabel });
}
// Before the photo is saved: every line is an active item - the shelf itself is re-checked in the transaction.
export async function checkStockLines(lines: { itemId: string; qty: number }[]): Promise<Fail | null> {
  if (!lines.length) return null;
  const found = await prisma.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, select: { id: true, name: true, active: true, onHand: true, unit: true } });
  for (const l of lines) {
    const it = found.find((f) => f.id === l.itemId);
    if (!it) return { error: "That item isn't in the inventory.", status: 400 };
    if (!it.active) return { error: `${it.name} has been retired.`, status: 400 };
    const plan = planMovement(it.onHand, it.unit, "OUT", l.qty);
    if ("error" in plan) return { error: `${it.name}: ${plan.error}`, status: 400 };
  }
  return null;
}

export async function itemHistory(itemId: string) {
  const it = await prisma.inventoryItem.findUnique({ where: { id: itemId }, include: { movements: { orderBy: { at: "desc" }, take: 300 } } });
  if (!it) return null;
  const reqIds = [...new Set(it.movements.map((m) => m.siteRequestId).filter(Boolean))] as string[];
  const reqs = reqIds.length ? await prisma.siteRequest.findMany({ where: { id: { in: reqIds } }, select: { id: true, number: true } }) : [];
  const no = new Map(reqs.map((r) => [r.id, requestNo(r.number)]));
  return {
    item: itemView({ ...it, movements: it.movements.slice(0, 1) }),
    movements: it.movements.map((m) => ({
      id: m.id, kind: m.kind, change: m.change, balanceAfter: m.balanceAfter, countedQty: m.countedQty, reason: m.reason,
      siteLabel: m.siteLabel, request: m.siteRequestId ? (no.get(m.siteRequestId) ?? null) : null, siteRequestId: m.siteRequestId, by: m.by, at: m.at.toISOString(),
    })),
  };
}

// "Below minimum": the first drop alerts the Admins once (amount-free); back at or above it clears the mark. The
// mark is set only where it is still empty, so two changes at once never alert twice.
export async function afterStockChange(itemIds: string[]) {
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } });
  for (const i of items) {
    const step = belowMinStep(i);
    if (step.clear) await prisma.inventoryItem.updateMany({ where: { id: i.id, belowMinAlertedAt: { not: null } }, data: { belowMinAlertedAt: null } });
    if (!step.alert) continue;
    const { count } = await prisma.inventoryItem.updateMany({ where: { id: i.id, belowMinAlertedAt: null }, data: { belowMinAlertedAt: new Date() } });
    if (!count) continue;
    await pushToAdmins({
      title: "Stock below minimum",
      body: `${i.name}: ${fmtQty(i.onHand)} ${i.unit} left (minimum ${fmtQty(i.minLevel ?? 0)})${i.location ? ` · ${i.location}` : ""}`,
      url: "/yard/inventory?below=1",
      tag: `stock-${i.id}`,
    }).catch((e) => console.error("stock alert", e));
  }
}
