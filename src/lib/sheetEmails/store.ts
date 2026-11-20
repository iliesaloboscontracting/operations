// The allocation email list - the database side (SheetEmailRecipient, 20 Nov 2026). Managers / Admins only: the API
// route guards; nothing here is reachable from a site link. Keep forever: nothing is deleted - removing an address
// sets removedAt, and adding it again makes a new row, so the old row is its history.
import { prisma } from "../prisma";
import { writeLock, type Who } from "../history/store";
import { MAX_SHEET_EMAILS, parseEmailBlock, planAdd, tidyReason } from "./rules";

export class SheetEmailError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const byName = (w: Who) => ((w?.name && w.name.trim()) || "Operations").slice(0, 120);

export type SheetEmailRow = {
  id: string; email: string; label: string | null; addedBy: string; addedAt: Date;
  removedBy: string | null; removedAt: Date | null; removedReason: string | null;
};
const SELECT = { id: true, email: true, label: true, addedBy: true, addedAt: true, removedBy: true, removedAt: true, removedReason: true } as const;

// The addresses "Open in email" puts in To - the list's order (oldest first).
export async function activeSheetEmails(): Promise<string[]> {
  const rows = await prisma.sheetEmailRecipient.findMany({ where: { active: true }, orderBy: [{ addedAt: "asc" }, { id: "asc" }], select: { email: true } });
  return rows.map((r) => r.email);
}

// The list as the screen shows it: who's on it, and every removal (newest first) with who / when / why.
export async function sheetEmailList(): Promise<{ active: SheetEmailRow[]; removed: SheetEmailRow[]; max: number }> {
  const [active, removed] = await Promise.all([
    prisma.sheetEmailRecipient.findMany({ where: { active: true }, orderBy: [{ addedAt: "asc" }, { id: "asc" }], select: SELECT }),
    prisma.sheetEmailRecipient.findMany({ where: { active: false }, orderBy: [{ removedAt: "desc" }, { id: "asc" }], select: SELECT, take: 300 }),
  ]);
  // An address removed and later added again shows once - on the list - not also under "Removed".
  const on = new Set(active.map((r) => r.email));
  const seen = new Set<string>();
  const latestRemoved = removed.filter((r) => !on.has(r.email) && !seen.has(r.email) && seen.add(r.email));
  return { active, removed: latestRemoved, max: MAX_SHEET_EMAILS };
}

// Add a pasted block. Valid new addresses go on; ones already on the list (or pasted twice) are counted; invalid ones
// are named back. Over the cap nothing is added (409). Returns the counts for "added N, already on the list M, ...".
export async function addSheetEmails(text: unknown, by: Who) {
  const parsed = parseEmailBlock(text);
  if (parsed.tooMany) throw new SheetEmailError("That's too much to paste at once - 300 addresses at most.");
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const active = await tx.sheetEmailRecipient.findMany({ where: { active: true }, select: { email: true } });
    const plan = planAdd(active.map((r) => r.email), parsed);
    if (plan.overCap)
      throw new SheetEmailError(`The list holds ${MAX_SHEET_EMAILS} addresses - this would make ${plan.total}. Remove some first.`, 409);
    for (const e of plan.toAdd) {
      await tx.sheetEmailRecipient.create({
        data: { email: e.email, activeEmail: e.email, label: e.label, addedBy: byName(by), addedById: by?.id ?? null },
      });
    }
    return { added: plan.toAdd.length, already: plan.already, invalid: parsed.invalid, total: plan.total };
  });
}

// Take an address off the list (kept forever - the row stays, marked removed, with who, when and why).
export async function removeSheetEmail(id: unknown, reasonIn: unknown, by: Who) {
  if (typeof id !== "string" || !id || id.length > 64) throw new SheetEmailError("Unknown address.", 404);
  const reason = tidyReason(reasonIn);
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const row = await tx.sheetEmailRecipient.findUnique({ where: { id }, select: { id: true, active: true } });
    if (!row) throw new SheetEmailError("Unknown address.", 404);
    if (!row.active) throw new SheetEmailError("That address is already off the list.", 409);
    await tx.sheetEmailRecipient.update({
      where: { id },
      data: { active: false, activeEmail: null, removedAt: new Date(), removedBy: byName(by), removedById: by?.id ?? null, removedReason: reason },
    });
    return { id };
  });
}
