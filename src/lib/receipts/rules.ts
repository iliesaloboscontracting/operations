// Receipts (docs/receipts/RECEIPTS-DESIGN.md, Ilies 25 Oct 2026) - the plain rules, no database:
// what a phone may send (R1 capture), what it gets back (never a price), and the odometer token.
// The store is ./store.ts; files are ./files.ts.
import { assertNoMoney } from "../moneyGuard";

export const RECEIPT_KINDS = ["TIP", "FUEL"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export const KIND_LABEL: Record<ReceiptKind, string> = { TIP: "Tip docket", FUEL: "Fuel" };

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
