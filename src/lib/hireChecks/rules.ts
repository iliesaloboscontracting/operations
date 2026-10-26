// Supplier hire invoices vs the hire register (Accounts stage 4, docs/accounts/STAGE4-DESIGN.md) - pure rules.
// For an item's linked invoices: days billed outside its on-hire period, more days than the register shows,
// the same days billed twice, a linked invoice with no period. Reuses the hire register's own helpers.
import { hireDayRate, weekdaysBetween, type HireLike } from "@/lib/hireEstimate";

export const EXTRA_DAYS_TOLERANCE = 0.5; // Draft - for Ilies / Victoria

export type HireItem = HireLike & { id: string; name: string };
export type HireInvoice = { id: string; invoiceNo: string | null; vendor: string; periodFrom: string | null; periodTo: string | null; amountExGst: number };
export type HireFlagKind = "OUTSIDE_PERIOD" | "MORE_DAYS" | "BILLED_TWICE" | "NO_PERIOD";
export type HireFlag = { invoiceId: string; kind: HireFlagKind; text: string };

const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);
const dayBefore = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
const dayAfter = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

export function checkHireInvoices(item: HireItem, invoices: HireInvoice[], today: string): HireFlag[] {
  const flags: HireFlag[] = [];
  const onHire = item.onHireDate ?? null;
  const offHire = item.offHireDate && item.offHireDate <= today ? item.offHireDate : item.offHireDate ?? today; // still on hire: up to today
  const dayRate = hireDayRate(item);
  const extras = (item.hireDeliveryCost ?? 0) + (item.hireCollectionCost ?? 0);
  for (const inv of invoices) {
    const no = inv.invoiceNo ? `Invoice ${inv.invoiceNo}` : "An invoice";
    if (!inv.periodFrom || !inv.periodTo) {
      flags.push({ invoiceId: inv.id, kind: "NO_PERIOD", text: `${no} is linked to "${item.name}" but has no hire period - it can't take days off the estimate.` });
      continue;
    }
    // Outside the on-hire window
    let outside = 0;
    if (onHire) {
      const before = inv.periodFrom < onHire ? weekdaysBetween(inv.periodFrom, minIso(inv.periodTo, dayBefore(onHire))) : 0;
      const after = inv.periodTo > offHire ? weekdaysBetween(maxIso(inv.periodFrom, dayAfter(offHire)), inv.periodTo) : 0;
      outside = before + after;
      if (outside > 0) {
        flags.push({ invoiceId: inv.id, kind: "OUTSIDE_PERIOD", text: `${no} bills ${before + after} weekday(s) outside the register's hire period (${onHire} to ${item.offHireDate ?? "still on hire"}).` });
      }
    }
    // More days than the register shows inside the invoice's period (amount / the item's own day rate) -
    // beyond any days already flagged as outside the period
    if (dayRate && dayRate > 0 && onHire) {
      const from = maxIso(inv.periodFrom, onHire), to = minIso(inv.periodTo, offHire);
      const registerDays = to >= from ? weekdaysBetween(from, to) : 0;
      const billedDays = Math.max(0, inv.amountExGst - extras) / dayRate;
      if (billedDays > registerDays + outside + EXTRA_DAYS_TOLERANCE) {
        flags.push({ invoiceId: inv.id, kind: "MORE_DAYS", text: `${no} comes to about ${Math.round(billedDays * 10) / 10} days' hire at the register's rate; the register shows ${registerDays} weekday(s) on hire in that period - extra days, or other charges (damage waiver, fuel, cleaning)?` });
      }
    }
  }
  // The same weekdays billed twice
  const withPeriod = invoices.filter((i) => i.periodFrom && i.periodTo).sort((a, b) => a.periodFrom!.localeCompare(b.periodFrom!));
  for (let i = 0; i < withPeriod.length; i++) {
    for (let j = i + 1; j < withPeriod.length; j++) {
      const a = withPeriod[i], b = withPeriod[j];
      const overlap = weekdaysBetween(maxIso(a.periodFrom!, b.periodFrom!), minIso(a.periodTo!, b.periodTo!));
      if (overlap > 0) {
        const text = `Invoices ${a.invoiceNo ?? "(no number)"} and ${b.invoiceNo ?? "(no number)"} both bill ${overlap} weekday(s) of "${item.name}".`;
        flags.push({ invoiceId: a.id, kind: "BILLED_TWICE", text }, { invoiceId: b.id, kind: "BILLED_TWICE", text });
      }
    }
  }
  return flags;
}
