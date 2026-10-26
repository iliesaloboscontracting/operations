// Accounts stage 5 (Compliance & HR, 26 Oct 2026), server side: worker tickets, onboarding, company /
// subcontractor documents, their files, and the expired-ticket flags for the Operations board.
// Accounts login + Admins (guardAccounts) for everything except flags() (Managers, labels and dates only).
// No money anywhere. TFN and bank details are refused (they stay in Xero). Nothing is deleted: archive instead.
// Design: docs/accounts/STAGE5-DESIGN.md.
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { syncReminder } from "./reminders";
import { saveComplianceFile } from "./files";
import {
  documentKindLabel, expiryState, isDocumentKind, isEmploymentType, isIsoDate, isTicketKind, looksLikeTfnOrBank,
  onboardingProgress, ticketLabel, worstState,
} from "./rules";
import { assetKindLabel, isAssetKind, isAssetResource, reminderCategory } from "../assets/rules";

type Problem = { error: string; status: number };
const bad = (error: string, status = 400): Problem => ({ error, status });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const XERO_ONLY = "TFN and bank details stay in Xero only - please don't type them here.";

// A text field: trimmed, capped, and refused if it looks like TFN or bank details.
function field(b: Record<string, unknown>, key: string, max: number, opts: { freeText?: boolean } = {}): { value: string | null } | Problem {
  const v = text(b[key], max);
  if (looksLikeTfnOrBank(v, opts)) return bad(XERO_ONLY);
  return { value: v || null };
}
function dateField(b: Record<string, unknown>, key: string, label: string): { value: string | null } | Problem {
  const v = b[key];
  if (v === "" || v == null) return { value: null };
  return isIsoDate(v) ? { value: v } : bad(`${label} isn't a valid date.`);
}
const isProblem = (x: unknown): x is Problem => !!x && typeof x === "object" && "error" in x;

// ---------- workers ----------

const fileDto = (f: { id: string; originalName: string; mime: string; size: number; createdAt: Date; uploadedBy: string }) =>
  ({ id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, createdAt: f.createdAt, uploadedBy: f.uploadedBy });

export async function listWorkers() {
  const today = todaySydney();
  const people = await prisma.resource.findMany({
    where: { type: "PERSONNEL", active: true },
    select: { id: true, name: true, role: true, category: true, workerTickets: { select: { status: true, expiryDate: true, kind: true, label: true } }, onboarding: true },
    orderBy: { name: "asc" },
  });
  return people.map((p) => {
    const active = p.workerTickets.filter((t) => t.status === "ACTIVE");
    const states = active.map((t) => ({ t, s: expiryState(t.expiryDate, today) }));
    const next = active.filter((t) => t.expiryDate).map((t) => t.expiryDate!).sort()[0] ?? null;
    return {
      id: p.id, name: p.name, role: p.role, category: p.category,
      worst: worstState(p.workerTickets, today),
      activeTickets: active.length,
      expired: states.filter((x) => x.s === "EXPIRED").map((x) => ticketLabel(x.t)),
      expiring: states.filter((x) => x.s === "EXPIRING").map((x) => ticketLabel(x.t)),
      nextExpiry: next,
      onboarding: onboardingProgress(p.onboarding),
    };
  });
}

export async function workerDetail(id: string) {
  const today = todaySydney();
  const p = await prisma.resource.findUnique({
    where: { id },
    select: {
      id: true, name: true, type: true, role: true, category: true, phone: true, email: true, tickets: true, active: true,
      workerTickets: { orderBy: [{ status: "asc" }, { expiryDate: "asc" }], include: { files: { where: { removedAt: null }, orderBy: { createdAt: "asc" } } } },
      onboarding: true,
    },
  });
  if (!p || p.type !== "PERSONNEL") return null;
  return {
    worker: { id: p.id, name: p.name, role: p.role, category: p.category, phone: p.phone, email: p.email, active: p.active, legacyTickets: p.tickets },
    tickets: p.workerTickets.map((t) => ({
      id: t.id, kind: t.kind, label: t.label, displayLabel: ticketLabel(t), number: t.number, issueDate: t.issueDate, expiryDate: t.expiryDate,
      status: t.status, archivedReason: t.archivedReason, replacesId: t.replacesId, notes: t.notes,
      state: t.status === "ACTIVE" ? expiryState(t.expiryDate, today) : null, files: t.files.map(fileDto),
      createdBy: t.createdBy, createdAt: t.createdAt, updatedBy: t.updatedBy, updatedAt: t.updatedAt,
    })),
    onboarding: p.onboarding,
    onboardingProgress: onboardingProgress(p.onboarding),
  };
}

function parseTicket(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || "kind" in b) {
    if (!isTicketKind(b.kind)) return bad("Pick what kind of ticket it is.");
    out.kind = b.kind;
  }
  for (const [key, max, free] of [["label", 80, false], ["number", 60, false], ["notes", 1000, true]] as const) {
    if (!partial || key in b) {
      const f = field(b, key, max, { freeText: free });
      if (isProblem(f)) return f;
      out[key] = f.value;
    }
  }
  for (const [key, label] of [["issueDate", "The issue date"], ["expiryDate", "The expiry date"]] as const) {
    if (!partial || key in b) {
      const d = dateField(b, key, label);
      if (isProblem(d)) return d;
      out[key] = d.value;
    }
  }
  return { data: out };
}

const ticketTitle = (worker: string, t: { kind: string; label: string | null }) => `Ticket expires: ${worker} - ${ticketLabel(t)}`;
async function syncTicket(db: Parameters<typeof syncReminder>[0], ticketId: string, by: string) {
  const t = await db.workerTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { resource: { select: { name: true, active: true } } } });
  await syncReminder(db, "WORKER_TICKET", t.id, { active: t.status === "ACTIVE" && t.resource.active, expiryDate: t.expiryDate, title: ticketTitle(t.resource.name, t) }, by);
}

export async function createTicket(by: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const resourceId = text(b.resourceId, 40);
  const person = resourceId ? await prisma.resource.findUnique({ where: { id: resourceId }, select: { type: true, active: true } }) : null;
  if (!person || person.type !== "PERSONNEL") return bad("Pick a worker from the Labour register.");
  const p = parseTicket(b, false);
  if (isProblem(p)) return p;
  const d = p.data as { kind: string; label: string | null; number: string | null; notes: string | null; issueDate: string | null; expiryDate: string | null };
  if (d.kind === "OTHER" && !d.label) return bad("Say what the ticket is.");
  if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) return bad("The expiry date is before the issue date.");
  const replacesId = text(b.replacesId, 40) || null;
  if (replacesId) {
    const old = await prisma.workerTicket.findUnique({ where: { id: replacesId } });
    if (!old || old.resourceId !== resourceId || old.status !== "ACTIVE") return bad("The ticket being renewed isn't an active ticket for this worker.");
  }
  const id = await prisma.$transaction(async (tx) => {
    const t = await tx.workerTicket.create({ data: { ...d, resourceId, replacesId, createdBy: by } });
    if (replacesId) {
      await tx.workerTicket.update({ where: { id: replacesId }, data: { status: "ARCHIVED", archivedReason: "Renewed", updatedBy: by } });
      await syncTicket(tx, replacesId, by);
    }
    await syncTicket(tx, t.id, by);
    return t.id;
  });
  return { id };
}

// EDIT (fields) | ARCHIVE { reason } | RESTORE
export async function actOnTicket(by: string, id: string, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const t = await prisma.workerTicket.findUnique({ where: { id } });
  if (!t) return bad("That ticket isn't there any more.", 404);
  const action = String(b.action ?? "EDIT").toUpperCase();
  let data: Record<string, unknown>;
  if (action === "ARCHIVE") {
    if (t.status !== "ACTIVE") return bad("It's already archived.", 409);
    const reason = field(b, "reason", 200, { freeText: true });
    if (isProblem(reason)) return reason;
    if (!reason.value) return bad("Say why (e.g. no longer held, entered by mistake).");
    data = { status: "ARCHIVED", archivedReason: reason.value };
  } else if (action === "RESTORE") {
    if (t.status === "ACTIVE") return bad("It's already active.", 409);
    data = { status: "ACTIVE", archivedReason: null };
  } else if (action === "EDIT") {
    const p = parseTicket(b, true);
    if (isProblem(p)) return p;
    data = p.data as Record<string, unknown>;
    const kind = (data.kind as string) ?? t.kind, label = "label" in data ? (data.label as string | null) : t.label;
    if (kind === "OTHER" && !label) return bad("Say what the ticket is.");
    const issue = "issueDate" in data ? (data.issueDate as string | null) : t.issueDate, expiry = "expiryDate" in data ? (data.expiryDate as string | null) : t.expiryDate;
    if (issue && expiry && expiry < issue) return bad("The expiry date is before the issue date.");
  } else return bad("Unknown action.");
  await prisma.$transaction(async (tx) => {
    await tx.workerTicket.update({ where: { id }, data: { ...data, updatedBy: by } });
    await syncTicket(tx, id, by);
  });
  return { ok: true };
}

export async function saveOnboarding(by: string, resourceId: string, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const person = await prisma.resource.findUnique({ where: { id: resourceId }, select: { type: true } });
  if (!person || person.type !== "PERSONNEL") return bad("That worker isn't in the Labour register.", 404);
  const data: Record<string, unknown> = {};
  for (const [key, max, free] of [["address", 200, true], ["emergencyName", 80, false], ["emergencyPhone", 30, false], ["emergencyRelation", 40, false], ["notes", 1000, true]] as const) {
    if (key in b) {
      const f = field(b, key, max, { freeText: free });
      if (isProblem(f)) return f;
      data[key] = f.value;
    }
  }
  for (const [key, label] of [["startDate", "The start date"], ["dateOfBirth", "The date of birth"], ["contractSigned", "The contract date"], ["policiesSigned", "The policies date"], ["inductionDate", "The induction date"]] as const) {
    if (key in b) {
      const d = dateField(b, key, label);
      if (isProblem(d)) return d;
      data[key] = d.value;
    }
  }
  if ("employmentType" in b) {
    if (b.employmentType && !isEmploymentType(b.employmentType)) return bad("Pick how they're employed.");
    data.employmentType = b.employmentType || null;
  }
  if ("abn" in b) {
    const abn = text(b.abn, 20).replace(/\s/g, "");
    if (abn && !/^\d{11}$/.test(abn)) return bad("An ABN is 11 digits.");
    data.abn = abn || null;
  }
  if ("xeroSetUp" in b) data.xeroSetUp = b.xeroSetUp === true;
  await prisma.workerOnboarding.upsert({ where: { resourceId }, create: { ...data, resourceId, updatedBy: by }, update: { ...data, updatedBy: by } });
  return { ok: true };
}

// ---------- company & subcontractor documents ----------

// Company & subcontractor documents by default; an asset's own documents (stage 6) when asked for by asset.
export async function listDocuments(opts: { all?: boolean; resourceId?: string; toolId?: string } = {}) {
  const today = todaySydney();
  const scope = opts.resourceId ? { resourceId: opts.resourceId } : opts.toolId ? { toolId: opts.toolId } : { holderType: { not: "ASSET" } };
  const rows = await prisma.complianceDocument.findMany({
    where: { ...scope, ...(opts.all ? {} : { status: "ACTIVE" }) },
    include: { files: { where: { removedAt: null }, orderBy: { createdAt: "asc" } } },
    orderBy: [{ holderType: "asc" }, { holderName: "asc" }, { expiryDate: "asc" }],
    take: 500,
  });
  return rows.map((d) => ({ ...d, kindLabel: d.holderType === "ASSET" ? assetKindLabel(d.kind) : documentKindLabel(d.kind), state: d.status === "ACTIVE" ? expiryState(d.expiryDate, today) : null, files: d.files.map(fileDto) }));
}

// Holder-name suggestions: the two companies, plus labour-hire / hire agencies already on the hire register.
export async function holderSuggestions() {
  const agencies = await prisma.resource.findMany({ where: { agency: { not: null } }, select: { agency: true }, distinct: ["agency"], take: 200 });
  return ["Lobos Contracting", "Lobos Civil", ...agencies.map((a) => a.agency!).filter(Boolean).sort()];
}

// asset = an asset's document (stage 6): asset kinds, and the holder is the asset itself (set by the caller).
function parseDocument(b: Record<string, unknown>, partial: boolean, asset = false) {
  const out: Record<string, unknown> = {};
  if (!asset && (!partial || "holderType" in b)) {
    if (b.holderType !== "COMPANY" && b.holderType !== "SUBCONTRACTOR") return bad("Is it a company or a subcontractor document?");
    out.holderType = b.holderType;
  }
  if (!partial || "kind" in b) {
    if (asset ? !isAssetKind(b.kind) : !isDocumentKind(b.kind)) return bad("Pick what kind of document it is.");
    out.kind = b.kind;
  }
  for (const [key, max, free, required] of [["holderName", 120, false, "Whose document is it?"], ["title", 120, false, "Give it a short name."], ["reference", 80, false, null], ["issuer", 120, false, null], ["notes", 1000, true, null]] as const) {
    if (asset && key === "holderName") continue;
    if (!partial || key in b) {
      const f = field(b, key, max, { freeText: free });
      if (isProblem(f)) return f;
      if (required && !f.value) return bad(required);
      out[key] = f.value;
    }
  }
  for (const [key, label] of [["issueDate", "The issue date"], ["expiryDate", "The expiry date"]] as const) {
    if (!partial || key in b) {
      const d = dateField(b, key, label);
      if (isProblem(d)) return d;
      out[key] = d.value;
    }
  }
  return { data: out };
}

const docTitle = (d: { holderType: string; holderName: string; title: string }) => `${d.holderName}: ${d.title} ${d.holderType === "ASSET" ? "due" : "expires"}`;
async function syncDocument(db: Parameters<typeof syncReminder>[0], id: string, by: string) {
  const d = await db.complianceDocument.findUniqueOrThrow({ where: { id } });
  await syncReminder(db, "COMPLIANCE_DOC", d.id, { active: d.status === "ACTIVE", expiryDate: d.expiryDate, title: docTitle(d) }, by, reminderCategory(d.kind));
}

// The asset a stage 6 document belongs to: an owned vehicle / plant item / attachment, or a tool.
async function assetFor(b: Record<string, unknown>): Promise<{ resourceId: string | null; toolId: string | null; name: string } | Problem> {
  const resourceId = text(b.resourceId, 40) || null, toolId = text(b.toolId, 40) || null;
  if (!!resourceId === !!toolId) return bad("Pick the vehicle, plant item or tool it belongs to.");
  if (resourceId) {
    const r = await prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true, type: true, ownership: true } });
    if (!r || !isAssetResource(r)) return bad("That isn't an owned vehicle or plant item.");
    return { resourceId, toolId: null, name: r.name };
  }
  const t = await prisma.tool.findUnique({ where: { id: toolId! }, select: { name: true, tag: true } });
  if (!t) return bad("That tool isn't in the register.");
  return { resourceId: null, toolId, name: [t.tag, t.name].filter(Boolean).join(" ") };
}

export async function createDocument(by: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const asset = b.holderType === "ASSET";
  const owner = asset ? await assetFor(b) : null;
  if (isProblem(owner)) return owner;
  if (asset && !text(b.title, 120)) b = { ...b, title: assetKindLabel(String(b.kind)) };
  const p = parseDocument(b, false, asset);
  if (isProblem(p)) return p;
  const d = p.data as { holderType: string; holderName: string; kind: string; title: string; reference: string | null; notes: string | null; issueDate: string | null; expiryDate: string | null };
  if (owner) Object.assign(d, { holderType: "ASSET", holderName: owner.name, resourceId: owner.resourceId, toolId: owner.toolId });
  if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) return bad("The expiry date is before the issue date.");
  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.complianceDocument.create({ data: { ...d, createdBy: by } });
    await syncDocument(tx, row.id, by);
    return row.id;
  });
  return { id };
}

export async function actOnDocument(by: string, id: string, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const doc = await prisma.complianceDocument.findUnique({ where: { id } });
  if (!doc) return bad("That document isn't there any more.", 404);
  const action = String(b.action ?? "EDIT").toUpperCase();
  let data: Record<string, unknown>;
  if (action === "ARCHIVE") {
    if (doc.status !== "ACTIVE") return bad("It's already archived.", 409);
    const reason = field(b, "reason", 200, { freeText: true });
    if (isProblem(reason)) return reason;
    if (!reason.value) return bad("Say why (e.g. replaced by the new policy).");
    data = { status: "ARCHIVED", archivedReason: reason.value };
  } else if (action === "RESTORE") {
    if (doc.status === "ACTIVE") return bad("It's already active.", 409);
    data = { status: "ACTIVE", archivedReason: null };
  } else if (action === "EDIT") {
    // An asset's document stays with its asset: its kind list is the asset one and its holder can't change.
    const p = parseDocument(b, true, doc.holderType === "ASSET");
    if (isProblem(p)) return p;
    data = p.data as Record<string, unknown>;
    const issue = "issueDate" in data ? (data.issueDate as string | null) : doc.issueDate, expiry = "expiryDate" in data ? (data.expiryDate as string | null) : doc.expiryDate;
    if (issue && expiry && expiry < issue) return bad("The expiry date is before the issue date.");
  } else return bad("Unknown action.");
  await prisma.$transaction(async (tx) => {
    await tx.complianceDocument.update({ where: { id }, data: { ...data, updatedBy: by } });
    await syncDocument(tx, id, by);
  });
  return { ok: true };
}

// ---------- files ----------

export async function addFile(by: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const ticketId = text(b.ticketId, 40) || null, documentId = text(b.documentId, 40) || null;
  if (!!ticketId === !!documentId) return bad("Attach the file to one ticket or one document.");
  if (ticketId && !(await prisma.workerTicket.findUnique({ where: { id: ticketId }, select: { id: true } }))) return bad("That ticket isn't there any more.", 404);
  if (documentId && !(await prisma.complianceDocument.findUnique({ where: { id: documentId }, select: { id: true } }))) return bad("That document isn't there any more.", 404);
  const originalName = text(b.originalName, 120);
  if (looksLikeTfnOrBank(originalName)) return bad(XERO_ONLY);
  const saved = await saveComplianceFile(b.dataUrl, originalName);
  if ("error" in saved) return bad(saved.error);
  const row = await prisma.complianceFile.create({ data: { fileName: saved.fileName, originalName, mime: saved.mime, size: saved.size, ticketId, documentId, uploadedBy: by } });
  return { id: row.id };
}

// "Remove" hides the file from the record; the file stays on disk and the row stays (never deleted).
export async function removeFile(by: string, id: string): Promise<{ ok: true } | Problem> {
  const f = await prisma.complianceFile.findUnique({ where: { id } });
  if (!f) return bad("That file isn't there any more.", 404);
  if (f.removedAt) return bad("It's already removed.", 409);
  await prisma.complianceFile.update({ where: { id }, data: { removedAt: new Date(), removedBy: by } });
  return { ok: true };
}

export async function fileForDownload(id: string) {
  const f = await prisma.complianceFile.findUnique({ where: { id } });
  return f && !f.removedAt ? f : null;
}

// ---------- the board flag (Managers): expired active tickets, labels and dates only ----------

export async function expiredTicketFlags(): Promise<Record<string, { expired: { label: string; expiryDate: string }[] }>> {
  const today = todaySydney();
  const rows = await prisma.workerTicket.findMany({
    where: { status: "ACTIVE", expiryDate: { lt: today }, resource: { active: true } },
    select: { resourceId: true, kind: true, label: true, expiryDate: true },
    orderBy: { expiryDate: "asc" },
  });
  const out: Record<string, { expired: { label: string; expiryDate: string }[] }> = {};
  for (const r of rows) (out[r.resourceId] ??= { expired: [] }).expired.push({ label: ticketLabel(r), expiryDate: r.expiryDate! });
  return out;
}
