// Admin change kinds (28 Oct 2026), server side: read the record a proposal is about (its "before"), the
// clash checks, and applying an approved change - always through the code the Admin screens run:
// tip rates (receipts/tipStore addRate / retireRate), removing an invoice (invoicedCosts
// removeInvoicedCost), a resource's rates / engagement (recordPatch applyResourcePatch, as an Admin),
// tickets and documents (compliance/store - which keep the one linked AccountsItem reminder).
// The plain rules are ./adminRules.ts; the flow (fingerprint, re-check, events) is ./store.ts.
import { prisma } from "../prisma";
import { addRate, retireRate } from "../receipts/tipStore";
import { normName, rateFor } from "../receipts/tipCosts";
import { removeInvoicedCost } from "../invoicedCosts";
import { applyResourcePatch } from "../recordPatch";
import { actOnDocument, actOnTicket, createDocument, createTicket } from "../compliance/store";
import { documentKindLabel, ticketLabel } from "../compliance/rules";
import { assetKindLabel, isAssetKind } from "../assets/rules";
import { PERSON_RATE_FIELDS, RATE_FIELDS, type AdminValue } from "./adminRules";
import type { ChangeKind } from "./config";

type Read = { name: string; value: AdminValue } | { error: string };
const pick = (r: Record<string, unknown>, keys: readonly string[]): AdminValue => Object.fromEntries(keys.map((k) => [k, (r[k] ?? null) as AdminValue[string]]));
const TICKET_KEYS = ["kind", "label", "expiryDate", "status"] as const;
const DOC_KEYS = ["holderType", "holderName", "kind", "title", "issuer", "expiryDate", "status"] as const;

export async function readAdminRecord(kind: ChangeKind, recordId: string, after: AdminValue): Promise<Read> {
  switch (kind) {
    case "TIP_RATE_ADD": {
      const site = String(after.tipSite ?? ""), waste = String(after.wasteType ?? ""), from = String(after.validFrom ?? "");
      const rates = await prisma.tipRate.findMany({ select: { id: true, tipSite: true, wasteType: true, ratePerTonneExGst: true, validFrom: true, retiredAt: true } });
      const sameDate = rates.find((r) => !r.retiredAt && r.validFrom === from && normName(r.tipSite) === normName(site) && normName(r.wasteType) === normName(waste));
      const inForce = rateFor(rates, site, waste || null, from);
      return {
        name: `${site} · ${waste || "any waste type"} from ${from}`,
        value: { sameDateRate: sameDate?.id ?? null, inForceRate: inForce?.ratePerTonneExGst ?? null, inForceFrom: inForce?.validFrom ?? null },
      };
    }
    case "TIP_RATE_RETIRE": {
      const r = await prisma.tipRate.findUnique({ where: { id: recordId } });
      if (!r) return { error: "That tip rate isn't there any more." };
      if (r.retiredAt) return { error: "That tip rate is already retired." };
      return { name: `${r.tipSite} · ${r.wasteType || "any waste type"}`, value: { tipSite: r.tipSite, wasteType: r.wasteType, ratePerTonneExGst: r.ratePerTonneExGst, validFrom: r.validFrom, retired: false } };
    }
    case "INVOICED_COST_REMOVE": {
      const c = await prisma.invoicedCost.findUnique({ where: { id: recordId }, include: { project: { select: { name: true, jobNo: true } } } });
      if (!c) return { error: "That invoice isn't on Tracking any more." };
      return {
        name: `${c.vendor} ${c.invoiceNo ?? "(no number)"}`,
        value: {
          vendor: c.vendor, invoiceNo: c.invoiceNo, category: c.category, amountExGst: c.amountExGst, totalIncGst: c.totalIncGst, weekEnding: c.weekEnding,
          projectId: c.projectId, job: [c.project.jobNo, c.project.name].filter(Boolean).join(" "), hireResourceId: c.hireResourceId, removed: false,
        },
      };
    }
    case "RESOURCE_RATE":
    case "RESOURCE_ENGAGEMENT": {
      const r = await prisma.resource.findUnique({ where: { id: recordId } });
      if (!r || !r.active) return { error: "That resource isn't active in Operations any more." };
      if (kind === "RESOURCE_ENGAGEMENT") {
        if (r.type !== "PERSONNEL") return { error: "Employee / ABN is for people in the Labour register." };
        return { name: r.name, value: { engagement: r.engagement } };
      }
      // A person has pay fields; plant, vehicles and hire have the day rate - never both (the schema's rule).
      const asked = Object.keys(after);
      if (r.type === "PERSONNEL" && asked.includes("dailyRateExGst")) return { error: "A person has pay rates, not a day rate." };
      if (r.type !== "PERSONNEL" && asked.some((k) => (PERSON_RATE_FIELDS as readonly string[]).includes(k))) return { error: "Pay rates are for people in the Labour register." };
      return { name: r.name, value: pick(r as unknown as Record<string, unknown>, RATE_FIELDS) };
    }
    case "WORKER_TICKET": {
      if (after.op === "CREATE") {
        const person = await prisma.resource.findUnique({ where: { id: String(after.resourceId ?? "") }, select: { name: true, type: true, active: true } });
        if (!person || person.type !== "PERSONNEL" || !person.active) return { error: "Pick a worker from the Labour register." };
        const twin = await prisma.workerTicket.findFirst({ where: { resourceId: String(after.resourceId), kind: String(after.kind), status: "ACTIVE" }, select: { id: true, label: true } });
        const sameOne = twin && normName(twin.label) === normName(after.label as string | null) ? twin.id : null;
        return { name: `${person.name} - ${ticketLabel({ kind: String(after.kind), label: after.label as string | null })}`, value: { activeSameTicket: sameOne } };
      }
      const t = await prisma.workerTicket.findUnique({ where: { id: recordId }, include: { resource: { select: { name: true } } } });
      if (!t || t.status !== "ACTIVE") return { error: "That ticket isn't an active ticket any more." };
      return { name: `${t.resource.name} - ${ticketLabel(t)}`, value: pick(t as unknown as Record<string, unknown>, TICKET_KEYS) };
    }
    case "COMPLIANCE_DOC": {
      if (after.op === "CREATE") {
        const label = isAssetKind(after.kind) ? assetKindLabel(String(after.kind)) : documentKindLabel(String(after.kind));
        let holder = String(after.holderName ?? "");
        if (after.holderType === "ASSET") {
          holder = after.resourceId
            ? (await prisma.resource.findUnique({ where: { id: String(after.resourceId) }, select: { name: true } }))?.name ?? ""
            : (await prisma.tool.findUnique({ where: { id: String(after.toolId) }, select: { name: true, tag: true } }).then((t) => (t ? [t.tag, t.name].filter(Boolean).join(" ") : "")));
          if (!holder) return { error: "That vehicle, plant item or tool isn't in the register." };
        }
        const twins = await prisma.complianceDocument.findMany({
          where: { status: "ACTIVE", kind: String(after.kind), holderType: String(after.holderType), ...(after.resourceId ? { resourceId: String(after.resourceId) } : {}), ...(after.toolId ? { toolId: String(after.toolId) } : {}) },
          select: { id: true, holderName: true, expiryDate: true },
        });
        const same = twins.find((d) => (after.holderType === "ASSET" || normName(d.holderName) === normName(holder)) && (d.expiryDate ?? null) === (after.expiryDate ?? null));
        return { name: `${holder}: ${after.title || label}`, value: { activeSameDocument: same?.id ?? null } };
      }
      const d = await prisma.complianceDocument.findUnique({ where: { id: recordId } });
      if (!d || d.status !== "ACTIVE") return { error: "That document isn't an active document any more." };
      return { name: `${d.holderName}: ${d.title}`, value: pick(d as unknown as Record<string, unknown>, DOC_KEYS) };
    }
    default:
      return { error: "Not an admin change." };
  }
}

// Refused at proposal (and STALE at approval): what's being added is already there.
export function adminConflict(kind: ChangeKind, before: AdminValue): string | null {
  if (kind === "TIP_RATE_ADD" && before.sameDateRate) return "There's already a rate for that site and waste type from that date - retire it first.";
  if (kind === "WORKER_TICKET" && before.activeSameTicket) return "This worker already has an active ticket of that type - propose an update to it instead.";
  if (kind === "COMPLIANCE_DOC" && before.activeSameDocument) return "That document is already there (same holder, type and expiry).";
  return null;
}

// Run an approved change. `by` is who it's recorded as on the record: the approver and the proposal.
export async function applyAdmin(kind: ChangeKind, recordId: string, after: AdminValue, ctx: { by: string; reason: string }): Promise<{ value: AdminValue } | { error: string }> {
  const fail = (o: { error: string }) => ({ error: o.error });
  switch (kind) {
    case "TIP_RATE_ADD": {
      const out = await addRate({ name: ctx.by }, { ...after, source: after.rateSource });
      return "error" in out ? fail(out) : { value: { tipRateId: out.id } };
    }
    case "TIP_RATE_RETIRE": {
      const out = await retireRate({ name: ctx.by }, recordId, ctx.reason);
      return "error" in out ? fail(out) : { value: { retired: true } };
    }
    case "INVOICED_COST_REMOVE": {
      const out = await removeInvoicedCost(recordId);
      return "error" in out ? fail(out) : { value: { removed: true } };
    }
    case "RESOURCE_RATE":
    case "RESOURCE_ENGAGEMENT": {
      // Approved by an Admin (cannotApprove checked it) - the PATCH's own Admin-only pay-field rule passes.
      const out = await applyResourcePatch(recordId, after, { role: "ADMIN" });
      return "error" in out ? fail(out) : { value: pick(out.resource as unknown as Record<string, unknown>, Object.keys(after)) };
    }
    case "WORKER_TICKET": {
      const { op, ...fields } = after;
      const out = op === "CREATE" ? await createTicket(ctx.by, fields) : await actOnTicket(ctx.by, recordId, { action: "EDIT", ...fields });
      return "error" in out ? fail(out) : { value: "id" in out ? { ticketId: out.id } : { updated: true } };
    }
    case "COMPLIANCE_DOC": {
      const { op, ...fields } = after;
      // A company / subcontractor document needs a title: its type, unless one was given (an asset's defaults in createDocument).
      if (op === "CREATE" && !fields.title && fields.holderType !== "ASSET") fields.title = documentKindLabel(String(fields.kind));
      const out = op === "CREATE" ? await createDocument(ctx.by, fields) : await actOnDocument(ctx.by, recordId, { action: "EDIT", ...fields });
      return "error" in out ? fail(out) : { value: "id" in out ? { documentId: out.id } : { updated: true } };
    }
    default:
      return { error: "Not an admin change." };
  }
}
