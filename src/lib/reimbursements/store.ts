// Reimbursements (Accounts stage 3, docs/accounts/STAGE3-DESIGN.md): claims from a receipt or entered by
// accounts, "Reimburse to <person>", ticked paid by Victoria. No double claims (rules.ts). Accounts screen
// only - nothing here reaches a link, Tracking or any job cost.
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { todaySydney } from "@/lib/today";
import { readReceiptPhoto, saveReceiptPhoto } from "@/lib/receipts/files";
import { addDays } from "@/lib/accounts/calendar";
import { cleanClaim, duplicatesOf, receiptAmount, type ClaimKey, type DuplicateHit } from "./rules";

type Problem = { error: string; status: number; duplicates?: ClaimDTO[] };
type Who = { id: string; name: string };

export type ClaimDTO = {
  id: string; personName: string; source: string; description: string; supplier: string | null; refNo: string | null;
  amountIncGst: number; spentOn: string; hasPhoto: boolean; status: string; paidOn: string | null; paidRef: string | null; paidBy: string | null;
  cancelReason: string | null; createdBy: string; createdAt: string; receiptKind: string | null; warnings: string[];
};
export type ReceiptToClaimDTO = { id: string; kind: string; sentBy: string; sentOn: string; refNo: string | null; amountIncGst: number | null; where: string | null; hasPhoto: boolean };

const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const hashOf = async (fileName: string | null | undefined) => {
  if (!fileName) return null;
  try { return createHash("sha256").update(await readReceiptPhoto(fileName)).digest("hex"); } catch { return null; }
};

type Row = Awaited<ReturnType<typeof prisma.reimbursement.findMany>>[number];
const keyOf = (r: Row): ClaimKey => ({ id: r.id, receiptId: r.receiptId, photoHash: r.photoHash, refNo: r.refNo, amountIncGst: r.amountIncGst, spentOn: r.spentOn, resourceId: r.resourceId, personName: r.personName, status: r.status });

function dto(r: Row, kinds: Map<string, string>, warnings: string[] = []): ClaimDTO {
  return {
    id: r.id, personName: r.personName, source: r.source, description: r.description, supplier: r.supplier, refNo: r.refNo,
    amountIncGst: r.amountIncGst, spentOn: r.spentOn, hasPhoto: !!r.photoFile, status: r.status, paidOn: r.paidOn, paidRef: r.paidRef, paidBy: r.paidBy,
    cancelReason: r.cancelReason, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), receiptKind: r.receiptId ? kinds.get(r.receiptId) ?? null : null, warnings,
  };
}

// Everything the Reimbursements page shows: to pay, paid / cancelled in the last 90 days, receipts that
// could be claimed (last 60 days, not claimed yet) and the people a claim can be for.
export async function listClaims() {
  const since = addDays(todaySydney(), -90);
  const rows = await prisma.reimbursement.findMany({ where: { OR: [{ status: "TO_PAY" }, { createdAt: { gte: new Date(`${since}T00:00:00Z`) } }] }, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }] });
  const claimedReceipts = new Set((await prisma.reimbursement.findMany({ where: { receiptId: { not: null }, status: { not: "CANCELLED" } }, select: { receiptId: true } })).map((r) => r.receiptId!));
  const receipts = await prisma.receipt.findMany({
    // Tip dockets are company costs on their job (Receipts -> tip costs), never a worker's reimbursement
    // (Ilies, 27 Oct 2026: "these are not reimbursements these tipping dockets").
    where: { sentAt: { gte: new Date(Date.now() - 60 * 86_400_000) }, status: { not: "REJECTED" }, kind: { not: "TIP" } },
    select: { id: true, kind: true, sentBy: true, sentAt: true, docketNo: true, docketAt: true, fuelTotal: true, priceIncGst: true, priceExGst: true, station: true, tipSite: true, _count: { select: { photos: true } } },
    orderBy: { sentAt: "desc" }, take: 300,
  });
  const kinds = new Map((await prisma.receipt.findMany({ where: { id: { in: rows.filter((r) => r.receiptId).map((r) => r.receiptId!) } }, select: { id: true, kind: true } })).map((r) => [r.id, r.kind]));
  const live = rows.filter((r) => r.status !== "CANCELLED").map(keyOf);
  const claims = rows.map((r) => dto(r, kinds, r.status === "CANCELLED" ? [] : duplicatesOf(keyOf(r), live).map((h) => `Check: ${h.why}`)));
  const people = await prisma.resource.findMany({ where: { type: "PERSONNEL", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return {
    today: todaySydney(),
    toPay: claims.filter((c) => c.status === "TO_PAY"),
    done: claims.filter((c) => c.status !== "TO_PAY"),
    toPayTotal: Math.round(claims.filter((c) => c.status === "TO_PAY").reduce((n, c) => n + c.amountIncGst, 0) * 100) / 100,
    receipts: receipts.filter((r) => !claimedReceipts.has(r.id)).map((r): ReceiptToClaimDTO => ({
      id: r.id, kind: r.kind, sentBy: r.sentBy, sentOn: sydneyDay(r.docketAt ?? r.sentAt), refNo: r.docketNo, amountIncGst: receiptAmount(r), where: r.kind === "FUEL" ? r.station : r.tipSite, hasPhoto: r._count.photos > 0,
    })),
    people,
  };
}

// A new claim, from a receipt (receiptId) or entered by accounts. Refused when it's a duplicate - the
// matching claim comes back so the page can show it.
export async function createClaim(who: Who, b: Record<string, unknown>): Promise<{ id: string; warnings: string[] } | Problem> {
  const today = todaySydney();
  let data: { resourceId: string | null; personName: string; receiptId: string | null; source: string; description: string; supplier: string | null; refNo: string | null; amountIncGst: number; spentOn: string; photoFile: string | null; photoHash: string | null };

  if (typeof b.receiptId === "string" && b.receiptId) {
    const r = await prisma.receipt.findUnique({ where: { id: b.receiptId }, include: { photos: { select: { fileName: true }, orderBy: { createdAt: "asc" } } } });
    if (!r || r.status === "REJECTED") return { error: "That receipt isn't available.", status: 404 };
    if (r.kind === "TIP") return { error: "A tip docket is a cost on its job, not a reimbursement.", status: 400 };
    const amount = b.amountIncGst != null && b.amountIncGst !== "" ? Number(String(b.amountIncGst).replace(/[$,\s]/g, "")) : receiptAmount(r);
    if (amount == null || !Number.isFinite(amount) || amount <= 0 || amount > 20_000) return { error: "The receipt hasn't been read - enter the amount (inc GST).", status: 400 };
    const photo = r.photos[0]?.fileName ?? null;
    data = {
      resourceId: r.sentByResourceId, personName: r.sentBy, receiptId: r.id, source: "RECEIPT",
      description: typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 200) : r.kind === "FUEL" ? "Fuel" : "Tip docket",
      supplier: (r.kind === "FUEL" ? r.station : r.tipSite) ?? null, refNo: r.docketNo, amountIncGst: Math.round(amount * 100) / 100,
      spentOn: sydneyDay(r.docketAt ?? r.sentAt), photoFile: photo, photoHash: await hashOf(photo),
    };
  } else {
    const c = cleanClaim(b, today);
    if ("error" in c) return { error: c.error, status: 400 };
    let resourceId: string | null = null, personName = c.personName;
    if (typeof b.resourceId === "string" && b.resourceId) {
      const p = await prisma.resource.findUnique({ where: { id: b.resourceId }, select: { id: true, name: true, type: true } });
      if (!p || p.type !== "PERSONNEL") return { error: "Pick the person again.", status: 400 };
      resourceId = p.id; personName = p.name;
    }
    if (personName.length < 2) return { error: "Who is it to be paid back to?", status: 400 };
    let photoFile: string | null = null;
    if (b.photo) {
      const saved = await saveReceiptPhoto(b.photo);
      if ("error" in saved) return { error: saved.error, status: 400 };
      photoFile = saved.fileName;
    }
    data = { resourceId, personName, receiptId: null, source: "ACCOUNTS", description: c.description, supplier: c.supplier, refNo: c.refNo, amountIncGst: c.amountIncGst, spentOn: c.spentOn, photoFile, photoHash: await hashOf(photoFile) };
  }

  // Candidates: the same receipt, the same photo, or anything on the same date (number / person rules).
  const candidates = await prisma.reimbursement.findMany({
    where: { status: { not: "CANCELLED" }, OR: [...(data.receiptId ? [{ receiptId: data.receiptId }] : []), ...(data.photoHash ? [{ photoHash: data.photoHash }] : []), { spentOn: data.spentOn }] },
  });
  const hits: DuplicateHit[] = duplicatesOf(data, candidates.map(keyOf));
  const blocking = hits.filter((h) => h.blocking);
  if (blocking.length) {
    const kinds = new Map<string, string>();
    return { error: `Already claimed: ${blocking[0].why}.`, status: 409, duplicates: candidates.filter((c) => blocking.some((h) => h.id === c.id)).map((c) => dto(c, kinds)) };
  }
  const row = await prisma.reimbursement.create({ data: { ...data, createdBy: who.name, createdById: who.id } });
  return { id: row.id, warnings: hits.map((h) => h.why) };
}

// Victoria ticks it paid (date + optional reference), or a claim made by mistake is cancelled with a reason.
export async function actOnClaim(who: Who, id: string, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const r = await prisma.reimbursement.findUnique({ where: { id } });
  if (!r) return { error: "Not found.", status: 404 };
  if (r.status !== "TO_PAY") return { error: `This claim is already ${r.status === "PAID" ? "paid" : "cancelled"}.`, status: 409 };
  if (b.action === "PAY") {
    const paidOn = typeof b.paidOn === "string" && b.paidOn ? b.paidOn : todaySydney();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > todaySydney()) return { error: "Enter the date it was paid (not in the future).", status: 400 };
    const paidRef = typeof b.paidRef === "string" ? b.paidRef.trim().slice(0, 80) || null : null;
    await prisma.reimbursement.update({ where: { id }, data: { status: "PAID", paidOn, paidRef, paidBy: who.name, paidAt: new Date() } });
    return { ok: true };
  }
  if (b.action === "CANCEL") {
    const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
    if (reason.length < 3) return { error: "Say why it's being cancelled.", status: 400 };
    await prisma.reimbursement.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason, cancelledBy: who.name, cancelledAt: new Date() } });
    return { ok: true };
  }
  return { error: "Unknown action.", status: 400 };
}

export async function claimPhoto(id: string): Promise<{ bytes: Buffer; fileName: string } | null> {
  const r = await prisma.reimbursement.findUnique({ where: { id }, select: { photoFile: true } });
  if (!r?.photoFile) return null;
  try { return { bytes: await readReceiptPhoto(r.photoFile), fileName: r.photoFile }; } catch { return null; }
}

export const claimsToPay = () => prisma.reimbursement.count({ where: { status: "TO_PAY" } });
