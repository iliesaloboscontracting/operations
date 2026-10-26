// Accounts stage 6 (27 Oct 2026): assets & fleet, server side. Reads what Operations already keeps - the Vehicles /
// Plant registers (Resource), the tool register (Tool, ToolIssue), service history (ServiceRecord), the daily log -
// and adds only: asset dates as stage 5 ComplianceDocuments, and "Link a mechanic invoice" from the invoices inbox.
// Accounts login + Admins (guardAccounts). Design: docs/accounts/STAGE6-DESIGN.md §2.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { listDocuments } from "../compliance/store";
import { dueSummary, isAssetResource, linkable } from "./rules";

type Problem = { error: string; status: number };
const bad = (error: string, status = 400): Problem => ({ error, status });
export type AssetGroup = "VEHICLES" | "PLANT" | "TOOLS";
const OPEN_TOOL_ISSUES = ["REPORTED", "SWAP_REQUESTED"];

export async function listAssets(group: AssetGroup) {
  const today = todaySydney();
  if (group === "TOOLS") {
    const tools = await prisma.tool.findMany({
      select: { id: true, tag: true, name: true, brand: true, condition: true, ownership: true, assetDocuments: { select: { kind: true, status: true, expiryDate: true } }, issues: { where: { status: { in: OPEN_TOOL_ISSUES } }, select: { id: true } } },
      orderBy: { tag: "asc" },
      take: 2000,
    });
    return tools.map((t) => ({
      kind: "tool" as const, id: t.id, name: `${t.tag} ${t.name}`, detail: [t.brand, t.ownership === "OWNED" ? null : t.ownership].filter(Boolean).join(" · "),
      status: t.condition, serviceDueText: null, due: dueSummary(t.assetDocuments, today, { vehicle: false }), openFaults: t.issues.length,
    }));
  }
  const types = group === "VEHICLES" ? ["VEHICLE"] : ["EQUIPMENT", "ATTACHMENT"];
  const rows = await prisma.resource.findMany({
    where: { type: { in: types }, active: true },
    select: { id: true, name: true, type: true, ownership: true, identifier: true, detail: true, status: true, serviceDue: true, assetDocuments: { select: { kind: true, status: true, expiryDate: true } } },
    orderBy: { name: "asc" },
  });
  return rows.filter(isAssetResource).map((r) => ({
    kind: "resource" as const, id: r.id, name: r.name, detail: [r.identifier, r.detail].filter(Boolean).join(" · "),
    status: r.status, serviceDueText: r.serviceDue, due: dueSummary(r.assetDocuments, today, { vehicle: r.type === "VEHICLE" }),
    openFaults: r.status === "DOWN" ? 1 : 0,
  }));
}

// Plant faults (D6): the item's DOWN status / notes, plus "Plant breakdown" delays on daily logs of jobs this item
// was booked on that day. The log doesn't say which machine broke down, so these are labelled as an inference.
async function breakdownsFor(resourceId: string) {
  const assignments = await prisma.assignment.findMany({ where: { resourceId }, select: { job: { select: { id: true, date: true, title: true, project: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 400 });
  const pairs = assignments.map((a) => ({ jobId: a.job.id, date: a.job.date.toISOString().slice(0, 10), site: a.job.project?.name ?? a.job.title }));
  if (!pairs.length) return [];
  const logs = await prisma.dailyLog.findMany({
    where: { OR: pairs.map((p) => ({ jobId: p.jobId, date: p.date })), delays: { some: { delayCode: "PLANT_BREAKDOWN" } } },
    select: { jobId: true, date: true, revision: true, delays: { where: { delayCode: "PLANT_BREAKDOWN" }, select: { hoursLost: true, note: true, affects: true } } },
    orderBy: [{ date: "desc" }, { revision: "desc" }],
  });
  const seen = new Set<string>(), out: { date: string; site: string; hoursLost: number | null; note: string | null }[] = [];
  for (const l of logs) {
    const key = `${l.jobId}|${l.date}`;
    if (seen.has(key)) continue; // the latest revision of each job's day
    seen.add(key);
    const site = pairs.find((p) => p.jobId === l.jobId)?.site ?? "";
    for (const d of l.delays) out.push({ date: l.date, site, hoursLost: d.hoursLost, note: d.note });
  }
  return out.slice(0, 50);
}

export async function resourceAsset(id: string) {
  const r = await prisma.resource.findUnique({
    where: { id },
    select: { id: true, name: true, type: true, ownership: true, identifier: true, detail: true, status: true, serviceDue: true, notes: true, active: true,
      serviceRecords: { orderBy: { date: "desc" }, take: 200 } },
  });
  if (!r || !isAssetResource(r)) return null;
  const [documents, breakdowns] = await Promise.all([listDocuments({ all: true, resourceId: id }), breakdownsFor(id)]);
  return {
    asset: { kind: "resource" as const, id: r.id, name: r.name, type: r.type, identifier: r.identifier, detail: r.detail, status: r.status, serviceDueText: r.serviceDue, notes: r.notes, active: r.active },
    documents,
    service: r.serviceRecords,
    faults: { down: r.status === "DOWN", breakdowns, toolIssues: [] as unknown[] },
  };
}

export async function toolAsset(id: string) {
  const t = await prisma.tool.findUnique({
    where: { id },
    select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true, ownership: true, heldBy: true, notes: true,
      issues: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, description: true, status: true, reportedBy: true, swapRef: true, resolution: true, resolvedAt: true, createdAt: true } } },
  });
  if (!t) return null;
  return {
    asset: { kind: "tool" as const, id: t.id, name: `${t.tag} ${t.name}`, detail: [t.brand, t.model, t.serialNumber].filter(Boolean).join(" · "), status: t.condition, ownership: t.ownership, heldBy: t.heldBy, notes: t.notes },
    documents: await listDocuments({ all: true, toolId: id }),
    service: [],
    faults: { down: t.condition === "Needs repair", breakdowns: [], toolIssues: t.issues },
  };
}

// Invoices-inbox lines that can be linked as a mechanic's service (D5): not linked yet, not a duplicate, last 12
// months. Amounts are shown - this is the Accounts screen.
export async function linkableInvoices(q: string) {
  const today = todaySydney();
  const linked = new Set((await prisma.serviceRecord.findMany({ where: { invoiceDraftId: { not: null } }, select: { invoiceDraftId: true } })).map((s) => s.invoiceDraftId!));
  const term = q.trim().slice(0, 60);
  const drafts = await prisma.invoiceDraft.findMany({
    where: term ? { OR: [{ supplier: { contains: term } }, { description: { contains: term } }, { invoiceNo: { contains: term } }] } : {},
    select: { id: true, supplier: true, invoiceNo: true, invoiceDate: true, description: true, amountExGst: true, gst: true, totalIncGst: true, status: true, createdAt: true, uploadId: true, upload: { select: { originalName: true } } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  return drafts.filter((d) => linkable(d, linked, d.id, today)).slice(0, 60)
    .map((d) => ({ id: d.id, supplier: d.supplier, invoiceNo: d.invoiceNo, invoiceDate: d.invoiceDate, description: d.description, amountExGst: d.amountExGst, totalIncGst: d.totalIncGst, uploadId: d.uploadId, file: d.upload.originalName }));
}

// "Link a mechanic invoice": a ServiceRecord made from the inbox line - one line, one record (unique). The inbox's
// own job-cost decision on the line is left exactly as it is.
export async function linkInvoice(by: string, resourceId: string, invoiceDraftId: string): Promise<{ id: string } | Problem> {
  const r = await prisma.resource.findUnique({ where: { id: resourceId }, select: { type: true, ownership: true } });
  if (!r || !isAssetResource(r)) return bad("That isn't an owned vehicle or plant item.", 404);
  const d = await prisma.invoiceDraft.findUnique({ where: { id: invoiceDraftId } });
  if (!d) return bad("That invoice line isn't in the inbox.", 404);
  if (d.status === "DUPLICATE") return bad("That line was marked as a duplicate in the inbox.");
  try {
    const row = await prisma.serviceRecord.create({
      data: {
        resourceId, invoiceDraftId, createdBy: by,
        date: d.invoiceDate ?? d.createdAt.toISOString().slice(0, 10),
        mechanic: d.supplier, invoiceNo: d.invoiceNo, work: d.description,
        amountExGst: d.amountExGst, gst: d.gst, total: d.totalIncGst,
        notes: "From the invoices inbox",
      },
    });
    return { id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return bad("That invoice is already linked to a service.", 409);
    throw e;
  }
}
