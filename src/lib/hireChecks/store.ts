// Hire invoices vs the hire register (Accounts stage 4, docs/accounts/STAGE4-DESIGN.md): every InvoicedCost
// linked to a hire-register item, checked against the item (rules.ts). Flags only - Tracking is unchanged.
import { prisma } from "@/lib/prisma";
import { todaySydney } from "@/lib/today";
import { latestFlagReviews } from "@/lib/invoiceFlagReviews";
import { checkHireInvoices } from "./rules";

export async function hireInvoiceChecks() {
  const today = todaySydney();
  const invoices = await prisma.invoicedCost.findMany({
    where: { hireResourceId: { not: null } },
    select: { id: true, invoiceNo: true, vendor: true, periodFrom: true, periodTo: true, amountExGst: true, hireResourceId: true, projectId: true, project: { select: { name: true } } },
  });
  const items = await prisma.resource.findMany({
    where: { id: { in: [...new Set(invoices.map((i) => i.hireResourceId!))] } },
    select: { id: true, name: true, agency: true, hireRef: true, onHireDate: true, offHireDate: true, hireRate: true, hireRateUnit: true, dailyRateExGst: true, hireDeliveryCost: true, hireCollectionCost: true, hireStatus: true },
  });
  const reviews = await latestFlagReviews("HIRE");
  const out = items.map((item) => {
    const mine = invoices.filter((i) => i.hireResourceId === item.id);
    const flags = checkHireInvoices(item, mine, today).map((f) => ({ ...f, review: reviews.get(`${f.invoiceId}|${f.kind}`) ?? null }));
    return {
      itemId: item.id, name: item.name, supplier: item.agency, hireRef: item.hireRef, onHireDate: item.onHireDate, offHireDate: item.offHireDate,
      project: mine[0]?.project?.name ?? null,
      invoices: mine.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, vendor: i.vendor, periodFrom: i.periodFrom, periodTo: i.periodTo, amountExGst: i.amountExGst, flags: flags.filter((f) => f.invoiceId === i.id) })),
      open: flags.filter((f) => f.review?.status !== "OK").length,
    };
  });
  return { items: out.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)), openFlags: out.reduce((n, i) => n + i.open, 0) };
}
