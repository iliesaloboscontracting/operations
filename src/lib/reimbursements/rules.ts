// Reimbursements (Accounts stage 3, docs/accounts/STAGE3-DESIGN.md) - the pure rules: no double claims, and
// what a claim needs. Money paid back to a worker; never a job cost.

export type ClaimKey = {
  id?: string;
  receiptId?: string | null;
  photoHash?: string | null;
  refNo?: string | null;
  amountIncGst: number;
  spentOn: string;
  resourceId?: string | null;
  personName: string;
  status?: string;
};

export type DuplicateHit = { id: string; why: string; blocking: boolean };

// "INV-00123" and "inv 123" are the same receipt number, as are "00123" and "123" (spaces, case, punctuation
// and leading zeros ignored); blank means none.
export const normRef = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]*)0+(?=\d)/, "$1") || null;
const sameCents = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
const samePerson = (a: ClaimKey, b: ClaimKey) => (a.resourceId && b.resourceId ? a.resourceId === b.resourceId : a.personName.trim().toLowerCase() === b.personName.trim().toLowerCase());

// Against every claim that isn't cancelled: the same receipt, the same photo, or the same number + amount +
// date blocks; the same person + amount + date with no number to tell them apart is a warning.
export function duplicatesOf(c: ClaimKey, existing: ClaimKey[]): DuplicateHit[] {
  const hits: DuplicateHit[] = [];
  const ref = normRef(c.refNo);
  for (const e of existing) {
    if (e.status === "CANCELLED" || (c.id && e.id === c.id)) continue;
    const id = e.id ?? "";
    if (c.receiptId && e.receiptId === c.receiptId) hits.push({ id, why: "the same receipt is already claimed", blocking: true });
    else if (c.photoHash && e.photoHash === c.photoHash) hits.push({ id, why: "the same photo is already claimed", blocking: true });
    else if (ref && normRef(e.refNo) === ref && sameCents(e.amountIncGst, c.amountIncGst) && e.spentOn === c.spentOn) hits.push({ id, why: "same receipt number, amount and date", blocking: true });
    else if ((!ref || !normRef(e.refNo)) && samePerson(c, e) && sameCents(e.amountIncGst, c.amountIncGst) && e.spentOn === c.spentOn) hits.push({ id, why: "same person, amount and date - possible duplicate", blocking: false });
  }
  return hits;
}

export type ClaimInput = { personName: string; description: string; amountIncGst: number; spentOn: string; supplier: string | null; refNo: string | null };

// What a claim entered by accounts needs. Returns the cleaned claim, or what's wrong.
export function cleanClaim(b: Record<string, unknown>, today: string): ClaimInput | { error: string } {
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const description = str(b.description, 200);
  const amount = typeof b.amountIncGst === "number" ? b.amountIncGst : Number(String(b.amountIncGst ?? "").replace(/[$,\s]/g, ""));
  const spentOn = str(b.spentOn, 10);
  if (description.length < 2) return { error: "Say what it was for." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20_000) return { error: "Enter the amount (inc GST)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || Number.isNaN(Date.parse(`${spentOn}T00:00:00Z`))) return { error: "Enter the date on the receipt." };
  if (spentOn > today) return { error: "The receipt date can't be in the future." };
  return { personName: str(b.personName, 80), description, amountIncGst: Math.round(amount * 100) / 100, spentOn, supplier: str(b.supplier, 80) || null, refNo: str(b.refNo, 40) || null };
}

// The amount a receipt shows (fuel: its total; an own-money purchase: its total; tip: inc GST, else ex GST
// + 10%). Null when it wasn't read.
export function receiptAmount(r: { kind: string; fuelTotal: number | null; priceIncGst: number | null; priceExGst: number | null; purchaseTotal?: number | null }): number | null {
  const v = r.kind === "FUEL" ? r.fuelTotal : r.kind === "PURCHASE" ? r.purchaseTotal ?? null : r.priceIncGst ?? (r.priceExGst != null ? r.priceExGst * 1.1 : null);
  return v == null ? null : Math.round(v * 100) / 100;
}
