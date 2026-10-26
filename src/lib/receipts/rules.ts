// Receipts (docs/receipts/RECEIPTS-DESIGN.md, Ilies 25 Oct 2026) - the plain rules, no database:
// what a phone may send (R1 capture), what it gets back (never a price), and the odometer token.
// The store is ./store.ts; files are ./files.ts.
import { assertNoMoney } from "../moneyGuard";

// PURCHASE: something a worker bought with their own money (tools, materials, parking...) - accounts only,
// sent from the Reimbursement tile (docs/accounts/REIMBURSE-LINK-DESIGN.md). Never on the Operations list.
export const RECEIPT_KINDS = ["TIP", "FUEL", "PURCHASE"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export const KIND_LABEL: Record<ReceiptKind, string> = { TIP: "Tip docket", FUEL: "Fuel", PURCHASE: "Purchase" };

// Phone links that can send receipts: supervisors (which includes the drivers Joao, Carlos, Villi,
// Rami and Pol) and the DRIVER link (Turori, Arvin) - which can do nothing else.
export const RECEIPT_LINK_KINDS = ["SUPERVISOR", "DRIVER"] as const;
export type ReceiptLinkKind = (typeof RECEIPT_LINK_KINDS)[number];

export const LIMITS = { photosPerReceipt: 2, photosPerLinkPerDay: 60, receiptsPerLinkPerDay: 40 };

// What the sender sees: read status only (R1: everything is waiting to be read).
export const STATUS_LABEL: Record<string, string> = {
  SENT: "Sent - waiting to be read",
  READ: "Read ✓",
  CHECK: "The office is checking it",
  CONFIRMED: "Checked ✓",
  REJECTED: "The office set it aside",
  SKIPPED: "No photo",
};

// Money guard for everything a link gets back: no dollar figure anywhere in it.
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x));

export type ReceiptInput = { kind: ReceiptKind; jobId: string | null; vehicleId: string | null; asbestos: boolean | null; photoIds: string[] };

// A new receipt from a phone. The job / truck only have to be chosen; whether they exist (and are
// ones the phone may pick) is checked by the store.
export function parseReceipt(b: Record<string, unknown>): ReceiptInput | { error: string } {
  const kind = b.kind;
  if (kind !== "TIP" && kind !== "FUEL") return { error: "Tip docket or fuel?" };
  const photoIds = Array.isArray(b.photoIds) ? [...new Set(b.photoIds.filter((x): x is string => typeof x === "string" && /^[a-z0-9]{20,40}$/.test(x)))] : [];
  if (photoIds.length === 0) return { error: "Take a photo of it first." };
  if (photoIds.length > LIMITS.photosPerReceipt) return { error: `At most ${LIMITS.photosPerReceipt} photos for one receipt.` };
  const id = (v: unknown) => (typeof v === "string" && /^[a-z0-9]{20,40}$/.test(v) ? v : null);
  if (kind === "TIP") {
    const jobId = id(b.jobId);
    if (!jobId) return { error: "Which job is it for?" };
    if (b.asbestos !== true && b.asbestos !== false) return { error: "Asbestos - yes or no?" };
    return { kind, jobId, vehicleId: null, asbestos: b.asbestos, photoIds };
  }
  const vehicleId = id(b.vehicleId);
  if (!vehicleId) return { error: "Which truck?" };
  return { kind, jobId: null, vehicleId, asbestos: null, photoIds };
}

// The "My receipts" row on the phone - kind, where, when and the read status. Never a price.
export type ReceiptLinkDTO = { id: string; kind: ReceiptKind; label: string; for: string; at: string; asbestos: boolean | null; photos: number; status: string };

// ---------- reimbursements from the phone (docs/accounts/REIMBURSE-LINK-DESIGN.md) ----------

export const PURPOSES = ["FUEL", "TOOLS", "MATERIALS", "PARKING_TOLLS", "OTHER"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = { FUEL: "Fuel", TOOLS: "Tools", MATERIALS: "Materials", PARKING_TOLLS: "Parking / tolls", OTHER: "Other" };

export type ReimburseInput = { purpose: Purpose; note: string | null; vehicleId: string | null; photoIds: string[] };

// "I paid this myself": what it was for (fuel also says which truck or plant), a short note (needed for
// Other), the photo(s) and the tap itself. Whether the truck / plant is ours is checked by the store.
export function parseReimbursement(b: Record<string, unknown>): ReimburseInput | { error: string } {
  if (b.paidMyself !== true) return { error: "Tap \"I paid this myself\" to send it." };
  const purpose = PURPOSES.find((p) => p === b.purpose);
  if (!purpose) return { error: "What was it for?" };
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim().slice(0, 120) || null : null;
  if (purpose === "OTHER" && (note?.length ?? 0) < 3) return { error: "Say what it was for." };
  if (note && !linkSafe(note)) return { error: "Leave the amount off - it's read from the photo." };
  const photoIds = Array.isArray(b.photoIds) ? [...new Set(b.photoIds.filter((x): x is string => typeof x === "string" && /^[a-z0-9]{20,40}$/.test(x)))] : [];
  if (photoIds.length === 0) return { error: "Take a photo of the receipt first." };
  if (photoIds.length > LIMITS.photosPerReceipt) return { error: `At most ${LIMITS.photosPerReceipt} photos for one receipt.` };
  const vehicleId = typeof b.vehicleId === "string" && /^[a-z0-9]{20,40}$/.test(b.vehicleId) ? b.vehicleId : null;
  if (purpose === "FUEL" && !vehicleId) return { error: "Which truck or machine was the fuel for?" };
  return { purpose, note, vehicleId: purpose === "FUEL" ? vehicleId : null, photoIds };
}

// What the worker sees about their claim - words and a date, never a figure. The cancel reason isn't
// shown (accounts may have written an amount in it).
export function reimburseStatus(receiptStatus: string, claim: { status: string; paidOn: string | null } | null): string {
  if (claim?.status === "PAID") return `Paid on ${claim.paidOn ? new Date(`${claim.paidOn}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }) : "-"}`;
  if (claim?.status === "CANCELLED" || receiptStatus === "REJECTED") return "Not going ahead - ask accounts";
  if (claim) return "With accounts";
  return receiptStatus === "SENT" ? "Sent - being read" : "Sent - accounts will check it";
}
