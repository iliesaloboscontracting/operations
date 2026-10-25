// Receipts R3 - tip costs, server side: the rate list (Admins edit), matching tip invoices to the
// dockets they bill (saved on Receipt.invoicedCostId), linking a docket's rego to our truck, what
// Tracking adds as estimates, and the two mismatch lists. Maths and rules: ./tipCosts.ts.
// Never touches frozen AllocationCost rows or closed days - estimates are live-only, like hire.
import { prisma } from "../prisma";
import { normRego } from "./checks";
import { docketCost, docketNosOf, isUninvoiced, matchAll, normName, rateFor, sydneyDay, type DocketCost, type Rate } from "./tipCosts";

type Problem = { error: string; status: number };
const COUNTED = ["READ", "CONFIRMED"];

export const loadRates = (): Promise<Rate[]> =>
  prisma.tipRate.findMany({ select: { id: true, tipSite: true, wasteType: true, ratePerTonneExGst: true, validFrom: true, retiredAt: true } });

const docketDay = (r: { docketAt: Date | null; sentAt: Date }) => sydneyDay(r.docketAt ?? r.sentAt);

// ---------- matching tip invoices to dockets ----------

let syncing = false;
// Recomputes every link (idempotent): sets Receipt.invoicedCostId where an invoice bills the docket,
// and clears it where the invoice was deleted, moved, re-categorised, or the docket set aside.
export async function syncTipMatches(): Promise<{ linked: number; cleared: number }> {
  if (syncing) return { linked: 0, cleared: 0 };
  syncing = true;
  try {
    const since = new Date(Date.now() - 400 * 86_400_000);
    const [invoices, dockets, linkedElsewhere] = await Promise.all([
      prisma.invoicedCost.findMany({ where: { category: "TIP_FEES" }, select: { id: true, projectId: true, vendor: true, weekEnding: true, periodFrom: true, periodTo: true, docketNos: true } }),
      prisma.receipt.findMany({ where: { kind: "TIP", status: { in: COUNTED }, projectId: { not: null }, sentAt: { gte: since } }, select: { id: true, projectId: true, docketNo: true, tipSite: true, docketAt: true, sentAt: true, invoicedCostId: true } }),
      prisma.receipt.findMany({ where: { invoicedCostId: { not: null }, OR: [{ kind: { not: "TIP" } }, { status: { notIn: COUNTED } }] }, select: { id: true } }),
    ]);
    const want = matchAll(
      invoices.map((i) => ({ ...i, docketNos: docketNosOf(i.docketNos) })),
      dockets.map((d) => ({ id: d.id, projectId: d.projectId, docketNo: d.docketNo, tipSite: d.tipSite, day: docketDay(d), invoicedCostId: d.invoicedCostId })),
    );
    let linked = 0, cleared = 0;
    for (const d of dockets) {
      const to = want.get(d.id) ?? null;
      if (to === d.invoicedCostId) continue;
      await prisma.receipt.update({ where: { id: d.id }, data: { invoicedCostId: to } });
      to ? linked++ : cleared++;
    }
    if (linkedElsewhere.length) {
      await prisma.receipt.updateMany({ where: { id: { in: linkedElsewhere.map((r) => r.id) } }, data: { invoicedCostId: null } });
      cleared += linkedElsewhere.length;
    }
    return { linked, cleared };
  } finally {
    syncing = false;
  }
}
export const syncTipMatchesSoon = () => { syncTipMatches().catch((e) => console.error("tip matching", e instanceof Error ? e.message : "failed")); };

// ---------- a docket's rego -> our truck (R4 needs it) ----------

export async function truckRegos(): Promise<{ id: string; rego: string }[]> {
  const trucks = await prisma.resource.findMany({ where: { type: "VEHICLE", ownership: "OWNED", NOT: { category: "Other" } }, select: { id: true, identifier: true, name: true } });
  // A truck's rego is its register identifier, or the rego at the end of its name ("Tipper - DD50LV").
  return trucks.map((t) => ({ id: t.id, rego: normRego(t.identifier || t.name.split(" - ").pop()) })).filter((t) => t.rego.length >= 4);
}
export const vehicleForRego = (rego: string | null | undefined, trucks: { id: string; rego: string }[]) => {
  const r = normRego(rego);
  return (r && trucks.find((t) => t.rego === r)?.id) || null;
};

// Read tip dockets with a rego of ours and no truck yet (dockets read before R3, or corrected).
export async function linkTipVehicles(): Promise<number> {
  const rows = await prisma.receipt.findMany({ where: { kind: "TIP", vehicleId: null, rego: { not: null }, status: { in: COUNTED } }, select: { id: true, rego: true }, take: 500 });
  if (!rows.length) return 0;
  const trucks = await truckRegos();
  let n = 0;
  for (const r of rows) {
    const v = vehicleForRego(r.rego, trucks);
    if (v) { await prisma.receipt.update({ where: { id: r.id }, data: { vehicleId: v } }); n++; }
  }
  return n;
}

// The tick (every ten minutes): late dockets meet their invoices, regos meet their trucks.
let lastTick = 0;
export async function tipTick() {
  if (Date.now() - lastTick < 10 * 60_000) return;
  lastTick = Date.now();
  await syncTipMatches();
  await linkTipVehicles();
}

// ---------- what Tracking adds ----------

export type TipDocketForTracking = DocketCost & {
  id: string; day: string; docketNo: string | null; tipSite: string | null; wasteType: string | null; tonnes: number | null; asbestos: boolean | null; invoicedCostId: string | null;
};
// Every counted tip docket, by project, with its cost. loadTracking decides which still count
// (not billed by one of that project's invoices).
export async function tipDocketsByProject(): Promise<Map<string, TipDocketForTracking[]>> {
  const [rows, rates] = await Promise.all([
    prisma.receipt.findMany({
      where: { kind: "TIP", status: { in: COUNTED }, projectId: { not: null } },
      select: { id: true, projectId: true, docketNo: true, docketAt: true, sentAt: true, tipSite: true, wasteType: true, tonnes: true, priceExGst: true, asbestos: true, invoicedCostId: true },
    }),
    loadRates(),
  ]);
  const out = new Map<string, TipDocketForTracking[]>();
  for (const r of rows) {
    const day = docketDay(r);
    const cost = docketCost({ priceExGst: r.priceExGst, tonnes: r.tonnes, tipSite: r.tipSite, wasteType: r.wasteType, day }, rates);
    const list = out.get(r.projectId!) ?? [];
    list.push({ ...cost, id: r.id, day, docketNo: r.docketNo, tipSite: r.tipSite, wasteType: r.wasteType, tonnes: r.tonnes, asbestos: r.asbestos, invoicedCostId: r.invoicedCostId });
    out.set(r.projectId!, list);
  }
  return out;
}

// ---------- the two mismatch lists (Operations side) ----------

export type TipMismatches = {
  uninvoiced: { id: string; projectId: string; projectName: string; day: string; docketNo: string | null; tipSite: string | null; tonnes: number | null }[];
  invoicesWithoutDockets: { id: string; projectId: string; projectName: string; vendor: string; invoiceNo: string | null; weekEnding: string; amountExGst: number }[];
};
export async function tipMismatches(today = sydneyDay(new Date())): Promise<TipMismatches> {
  const since = new Date(Date.now() - 400 * 86_400_000);
  const [dockets, invoices, linked] = await Promise.all([
    prisma.receipt.findMany({ where: { kind: "TIP", status: { in: COUNTED }, projectId: { not: null }, invoicedCostId: null, sentAt: { gte: since } }, select: { id: true, projectId: true, docketNo: true, docketAt: true, sentAt: true, tipSite: true, tonnes: true } }),
    prisma.invoicedCost.findMany({ where: { category: "TIP_FEES", weekEnding: { gte: since.toISOString().slice(0, 10) } }, select: { id: true, projectId: true, vendor: true, invoiceNo: true, weekEnding: true, amountExGst: true } }),
    prisma.receipt.findMany({ where: { invoicedCostId: { not: null } }, select: { invoicedCostId: true }, distinct: ["invoicedCostId"] }),
  ]);
  const projects = new Map((await prisma.project.findMany({ where: { id: { in: [...new Set([...dockets.map((d) => d.projectId!), ...invoices.map((i) => i.projectId)])] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const billed = new Set(linked.map((l) => l.invoicedCostId));
  return {
    uninvoiced: dockets.map((d) => ({ ...d, day: docketDay(d) })).filter((d) => isUninvoiced({ day: d.day, invoicedCostId: null }, today))
      .map((d) => ({ id: d.id, projectId: d.projectId!, projectName: projects.get(d.projectId!) ?? "a job", day: d.day, docketNo: d.docketNo, tipSite: d.tipSite, tonnes: d.tonnes }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    invoicesWithoutDockets: invoices.filter((i) => !billed.has(i.id) && i.amountExGst > 0)
      .map((i) => ({ ...i, projectName: projects.get(i.projectId) ?? "a job" }))
      .sort((a, b) => a.weekEnding.localeCompare(b.weekEnding)),
  };
}

// ---------- the rate list (/receipts -> Tip rates) ----------

export type TipRateDTO = { id: string; tipSite: string; wasteType: string; ratePerTonneExGst: number; validFrom: string; source: string; note: string | null; createdBy: string; createdAt: string; retired: { at: string; by: string | null; reason: string | null } | null; inForce: boolean };
export async function listRates(): Promise<{ rates: TipRateDTO[]; missing: { tipSite: string; wasteType: string; dockets: number }[] }> {
  const [rows, unpriced] = await Promise.all([
    prisma.tipRate.findMany({ orderBy: [{ tipSite: "asc" }, { wasteType: "asc" }, { validFrom: "desc" }] }),
    prisma.receipt.findMany({ where: { kind: "TIP", status: { in: COUNTED }, invoicedCostId: null, priceExGst: null, tonnes: { gt: 0 }, tipSite: { not: null } }, select: { tipSite: true, wasteType: true, docketAt: true, sentAt: true } }),
  ]);
  const today = sydneyDay(new Date());
  const inForce = new Set(rows.map((r) => rateFor(rows, r.tipSite, r.wasteType || null, today)?.id).filter(Boolean));
  // Site + waste combinations on dockets that no rate covers yet ("Add a tip rate").
  const missing = new Map<string, { tipSite: string; wasteType: string; dockets: number }>();
  for (const d of unpriced) {
    if (rateFor(rows, d.tipSite, d.wasteType, docketDay(d))) continue;
    const k = `${normName(d.tipSite)}|${normName(d.wasteType)}`;
    const m = missing.get(k) ?? { tipSite: d.tipSite!, wasteType: d.wasteType ?? "", dockets: 0 };
    m.dockets++;
    missing.set(k, m);
  }
  return {
    rates: rows.map((r) => ({
      id: r.id, tipSite: r.tipSite, wasteType: r.wasteType, ratePerTonneExGst: r.ratePerTonneExGst, validFrom: r.validFrom, source: r.source, note: r.note,
      createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), retired: r.retiredAt ? { at: r.retiredAt.toISOString(), by: r.retiredBy, reason: r.retiredReason } : null, inForce: inForce.has(r.id),
    })),
    missing: [...missing.values()].sort((a, b) => b.dockets - a.dockets),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function addRate(who: { name: string }, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const tipSite = text(b.tipSite, 100), wasteType = text(b.wasteType, 80), source = text(b.source, 200), note = text(b.note, 300) || null;
  const rate = Number(b.ratePerTonneExGst);
  const validFrom = text(b.validFrom, 10);
  if (tipSite.length < 2) return { error: "Enter the tip site.", status: 400 };
  if (!Number.isFinite(rate) || rate <= 0 || rate > 2000) return { error: "Enter the rate per tonne ex GST.", status: 400 };
  if (!ISO.test(validFrom) || Number.isNaN(Date.parse(validFrom))) return { error: "Enter the date the rate starts.", status: 400 };
  if (source.length < 3) return { error: "Say where the rate comes from (quote, invoice, email).", status: 400 };
  const same = await prisma.tipRate.findFirst({ where: { retiredAt: null, validFrom }, select: { id: true, tipSite: true, wasteType: true } });
  const clash = same && normName(same.tipSite) === normName(tipSite) && normName(same.wasteType) === normName(wasteType);
  if (clash) return { error: "There's already a rate for that site and waste type from that date - retire it first.", status: 409 };
  const r = await prisma.tipRate.create({ data: { tipSite, wasteType, ratePerTonneExGst: Math.round(rate * 100) / 100, validFrom, source, note, createdBy: who.name } });
  return { id: r.id };
}

export async function retireRate(who: { name: string }, id: string, reasonIn: unknown): Promise<{ ok: true } | Problem> {
  const reason = text(reasonIn, 300);
  if (reason.length < 3) return { error: "Say why it's being retired.", status: 400 };
  const r = await prisma.tipRate.findUnique({ where: { id } });
  if (!r) return { error: "Not found", status: 404 };
  if (r.retiredAt) return { error: "Already retired.", status: 409 };
  await prisma.tipRate.update({ where: { id }, data: { retiredAt: new Date(), retiredBy: who.name, retiredReason: reason } });
  return { ok: true };
}
