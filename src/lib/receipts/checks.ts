// Receipts R2 - the plain rules that decide what Claude's reading becomes (design §Reading):
// READ (goes in) or CHECK (an office person confirms). No database here; ./runner.ts gathers the
// facts (our regos, earlier dockets, the truck's last odometer) and saves the result.
import type { FuelReading, OdometerReadingResult, PurchaseReading, TipReading } from "./reading";
import { fromSydneyLocal } from "../shiftTimes";

export type Decision = { status: "READ" | "CHECK"; reasons: string[] };

// "6.24 t", "1,234.50", "$412.50" -> number; anything else -> null.
export function num(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
export const normRego = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normDocket = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");

// "2026-10-26T07:42" or "2026-10-26" (Sydney wall clock) -> that moment; a date alone is Sydney midday.
export function docketDate(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec((s ?? "").trim());
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31 || (m[4] && (+m[4] > 23 || +m[5] > 59))) return null;
  return fromSydneyLocal(`${m[1]}-${m[2]}-${m[3]}T${m[4] ? `${m[4]}:${m[5]}` : "12:00"}`);
}

export const ASBESTOS = /asbestos|\bacm\b|friable|bonded/i;
const DAY = 86_400_000;
const LABEL: Record<string, string> = {
  docketNo: "docket number", dateTime: "date", tipSite: "tip site", wasteType: "waste type", tonnesNet: "tonnes", rego: "rego",
  priceExGst: "price", priceIncGst: "price", litres: "litres", pricePerLitre: "price per litre", total: "total", station: "station",
  supplier: "shop", receiptNo: "receipt number", gst: "GST",
};

function common(dateTime: string, unclear: string[], sentAt: Date, rego: string, ourRegos: string[], reasons: string[]) {
  const d = docketDate(dateTime);
  if (d && Math.abs(d.getTime() - sentAt.getTime()) > 2 * DAY) reasons.push(`Dated ${dateTime.slice(0, 10)} - more than 2 days from when it was sent`);
  const r = normRego(rego);
  if (r && !ourRegos.map(normRego).includes(r)) reasons.push(`Rego ${r} isn't one of our trucks`);
  const shaky = [...new Set(unclear.map((f) => LABEL[f] ?? f))];
  if (shaky.length) reasons.push(`Not clear on the photo: ${shaky.join(", ")}`);
}

// Tip docket: docket number, date, tip site, waste type and net tonnes are the key fields; the price
// isn't (R3 prices it from the tip rate when it's missing).
export function decideTip(x: TipReading, f: { sentAt: Date; asbestosTap: boolean | null; ourRegos: string[]; duplicateOf: string | null }): Decision {
  const reasons: string[] = [];
  if (x.documentType === "fuel_receipt" || x.documentType === "other") reasons.push(x.documentType === "fuel_receipt" ? "Looks like a fuel receipt, not a tip docket" : "Doesn't look like a tip docket");
  const missing = [
    !x.docketNo.trim() && "docket number", !docketDate(x.dateTime) && "date", !x.tipSite.trim() && "tip site", !x.wasteType.trim() && "waste type",
    !(num(x.tonnesNet)! > 0) && "tonnes",
  ].filter(Boolean);
  if (missing.length) reasons.push(`Missing: ${missing.join(", ")}`);
  const t = num(x.tonnesNet);
  if (t != null && t > 60) reasons.push(`${t} tonnes is more than a truck carries`);
  if (f.duplicateOf) reasons.push(`Docket number ${x.docketNo} was already sent (${f.duplicateOf})`);
  if (x.wasteType.trim() && f.asbestosTap !== null && ASBESTOS.test(x.wasteType) !== f.asbestosTap) {
    reasons.push(f.asbestosTap ? `Sent as asbestos, but the docket says "${x.wasteType}"` : `The docket says "${x.wasteType}", but it was sent as not asbestos`);
  }
  common(x.dateTime, x.unclear, f.sentAt, x.rego, f.ourRegos, reasons);
  if (x.note.trim()) reasons.push(`Reader's note: ${x.note.trim()}`);
  return { status: reasons.length ? "CHECK" : "READ", reasons };
}

// Fuel: litres, total and date are the key fields. A printed rego that's another of our trucks is
// worth a look too (the wrong truck may have been picked).
export function decideFuel(x: FuelReading, f: { sentAt: Date; ourRegos: string[]; pickedRego: string | null }): Decision {
  const reasons: string[] = [];
  if (x.documentType !== "fuel_receipt") reasons.push(x.documentType === "tip_docket" ? "Looks like a tip docket, not a fuel receipt" : "Doesn't look like a fuel receipt");
  const litres = num(x.litres), total = num(x.total), ppl = num(x.pricePerLitre);
  const missing = [!(litres! > 0) && "litres", !(total! > 0) && "total", !docketDate(x.dateTime) && "date"].filter(Boolean);
  if (missing.length) reasons.push(`Missing: ${missing.join(", ")}`);
  if (litres != null && litres > 1000) reasons.push(`${litres} L is more than a truck's tank`);
  if (litres && total && ppl && Math.abs(litres * ppl - total) > Math.max(2, total * 0.03)) reasons.push("Litres × price per litre doesn't come to the total");
  const r = normRego(x.rego);
  if (r && f.pickedRego && f.ourRegos.map(normRego).includes(r) && r !== normRego(f.pickedRego)) reasons.push(`The receipt says ${r}, but it was sent for ${normRego(f.pickedRego)}`);
  common(x.dateTime, x.unclear, f.sentAt, x.rego, f.ourRegos, reasons);
  if (x.note.trim()) reasons.push(`Reader's note: ${x.note.trim()}`);
  return { status: reasons.length ? "CHECK" : "READ", reasons };
}

// An own-money purchase: the total and the date are the key fields (the shop too). Over the cap, or a tip
// docket / fuel receipt sent as a purchase, waits for a person.
export const PURCHASE_CAP = 5000; // Draft - a bigger receipt is checked by a person
export function decidePurchase(x: PurchaseReading, f: { sentAt: Date }): Decision {
  const reasons: string[] = [];
  if (x.documentType === "tip_docket") reasons.push("Looks like a tip docket - those are company costs, not reimbursements");
  else if (x.documentType === "fuel_receipt") reasons.push("Looks like a fuel receipt - send fuel with the truck or machine it was for");
  else if (x.documentType === "other") reasons.push("Doesn't look like a receipt");
  const total = num(x.total);
  const missing = [!(total! > 0) && "total", !docketDate(x.dateTime) && "date", !x.supplier.trim() && "shop"].filter(Boolean);
  if (missing.length) reasons.push(`Missing: ${missing.join(", ")}`);
  if (total != null && total > PURCHASE_CAP) reasons.push(`Over ${PURCHASE_CAP.toLocaleString("en-AU")} - worth a look`);
  const d = docketDate(x.dateTime);
  if (d && Math.abs(d.getTime() - f.sentAt.getTime()) > 30 * DAY) reasons.push(`Dated ${x.dateTime.slice(0, 10)} - more than a month before it was sent`);
  const shaky = [...new Set(x.unclear.map((k) => LABEL[k] ?? k))];
  if (shaky.length) reasons.push(`Not clear on the photo: ${shaky.join(", ")}`);
  if (x.note.trim()) reasons.push(`Reader's note: ${x.note.trim()}`);
  return { status: reasons.length ? "CHECK" : "READ", reasons };
}
export function purchaseFields(x: PurchaseReading) {
  return { supplier: x.supplier.trim() || null, docketNo: x.receiptNo.trim() || null, docketAt: docketDate(x.dateTime), purchaseTotal: num(x.total) };
}

// Odometer: the km, against the truck's last reading - never backwards, never more than 1,500 km a day.
export function decideOdometer(x: OdometerReadingResult, f: { sentAt: Date; previous: { km: number; at: Date } | null }): Decision {
  const reasons: string[] = [];
  const km = num(x.km);
  if (km == null || km <= 0) reasons.push("No odometer reading on the photo");
  if (x.unclear) reasons.push("The digits aren't all clear");
  if (km != null && km > 0 && f.previous) {
    const days = Math.max(1, Math.ceil((f.sentAt.getTime() - f.previous.at.getTime()) / DAY));
    if (km < f.previous.km) reasons.push(`Lower than the last reading (${f.previous.km.toLocaleString("en-AU")} km)`);
    else if (km - f.previous.km > 1500 * days) reasons.push(`${(km - f.previous.km).toLocaleString("en-AU")} km since the last reading ${days === 1 ? "a day ago" : `${days} days ago`} - more than 1,500 km a day`);
  }
  if (x.note.trim()) reasons.push(`Reader's note: ${x.note.trim()}`);
  return { status: reasons.length ? "CHECK" : "READ", reasons };
}

// What a reading puts in the Receipt's own columns.
export function tipFields(x: TipReading) {
  return {
    docketNo: x.docketNo.trim() || null, docketAt: docketDate(x.dateTime), tipSite: x.tipSite.trim() || null, wasteType: x.wasteType.trim() || null,
    tonnes: num(x.tonnesNet), priceExGst: num(x.priceExGst), priceIncGst: num(x.priceIncGst), rego: normRego(x.rego) || null,
  };
}
export function fuelFields(x: FuelReading) {
  const litres = num(x.litres), total = num(x.total);
  const ppl = num(x.pricePerLitre) ?? (litres && total ? Math.round((total / litres) * 1000) / 1000 : null);
  return { litres, pricePerLitre: ppl, fuelTotal: total, station: x.station.trim() || null, docketAt: docketDate(x.dateTime), rego: normRego(x.rego) || null };
}
