// One change history for edits to business records (keep forever, Ilies 10 Nov 2026) - the database side. Every
// recorded edit goes through updateTracked / recordChanges INSIDE the same transaction as the edit, so an edit and its
// history are saved together or not at all. Rows are only ever added (RecordChange is append-only).
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { diffFields, type FieldChange, type HistoryModel } from "./diff";

export type Tx = Prisma.TransactionClient;
export type Who = { id?: string | null; name?: string | null } | null | undefined;
export type HistoryCtx = { by: Who; source: string; reason?: string | null };

const byName = (w: Who) => (w?.name && w.name.trim()) || "Operations";
const delegate = (db: Tx | PrismaClient, model: HistoryModel) =>
  (db as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; update: (a: unknown) => Promise<Record<string, unknown>> }>)[
    model.charAt(0).toLowerCase() + model.slice(1)
  ];

// Takes SQLite's write lock at the start of a transaction (an UPDATE that touches no row still claims it), so a
// transaction that reads and then writes can't deadlock with another doing the same - the second simply waits.
export async function writeLock(tx: Tx) {
  await tx.$executeRawUnsafe('UPDATE "RecordChange" SET "id" = "id" WHERE 0');
}

// Writes one row per changed field. Returns how many.
export async function writeChanges(db: Tx | PrismaClient, model: HistoryModel, recordId: string, changes: FieldChange[], ctx: HistoryCtx): Promise<number> {
  if (!changes.length) return 0;
  const by = byName(ctx.by);
  await db.recordChange.createMany({
    data: changes.map((c) => ({
      model, recordId, field: c.field, before: c.before, after: c.after,
      changedBy: by.slice(0, 120), changedById: ctx.by?.id ?? null, source: ctx.source.slice(0, 160), reason: ctx.reason ? ctx.reason.slice(0, 500) : null,
    })),
  });
  return changes.length;
}

// The row before and after an edit -> its history, only the fields that changed (optionally only those named).
export async function recordChanges(
  db: Tx | PrismaClient, model: HistoryModel, recordId: string,
  before: Record<string, unknown> | null, after: Record<string, unknown>, ctx: HistoryCtx, fields?: readonly string[],
): Promise<number> {
  return writeChanges(db, model, recordId, diffFields(before, after, fields), ctx);
}

// Reads the record, updates it and records what changed - all in one transaction (or in the caller's, when given).
// Throws as prisma.update does when the record isn't there.
export async function updateTracked<T = Record<string, unknown>>(
  model: HistoryModel, id: string, data: Record<string, unknown>, ctx: HistoryCtx, opts: { tx?: Tx; include?: unknown } = {},
): Promise<T> {
  const run = async (tx: Tx, own = false) => {
    if (own) await writeLock(tx);
    const d = delegate(tx, model);
    const before = await d.findUnique({ where: { id } });
    const after = await d.update({ where: { id }, data, ...(opts.include ? { include: opts.include } : {}) });
    await recordChanges(tx, model, id, before, after, ctx, Object.keys(data));
    return after as T;
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction((tx) => run(tx, true));
}

// "Remove" = hide (removedAt / removedBy / removeReason), recorded like any edit. Never twice: a hidden row stays as it is.
export async function hideTracked<T = Record<string, unknown>>(model: HistoryModel, id: string, ctx: HistoryCtx, opts: { tx?: Tx; extra?: Record<string, unknown> } = {}): Promise<T | null> {
  const run = async (tx: Tx, own = false) => {
    if (own) await writeLock(tx);
    const row = await delegate(tx, model).findUnique({ where: { id } });
    if (!row || row.removedAt) return null;
    return updateTracked<T>(model, id, { removedAt: new Date(), removedBy: byName(ctx.by).slice(0, 120), removeReason: ctx.reason?.trim().slice(0, 500) || null, ...(opts.extra ?? {}) }, ctx, { tx });
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction((tx) => run(tx, true));
}

// A record's history, newest first (the caller filters it by role - access.ts).
export function historyOf(model: HistoryModel, recordId: string, take = 300) {
  return prisma.recordChange.findMany({ where: { model, recordId }, orderBy: { changedAt: "desc" }, take });
}
