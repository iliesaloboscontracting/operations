// The invoices inbox (24 Oct 2026). Accounts upload supplier invoices (PDF /
// photo) or their invoice register spreadsheet; Claude reads them
// (lib/invoiceReading.ts) and these plain rules decide what happens:
//  - a clear match to a job goes straight onto it (Ilies: "auto when matched"),
//  - anything unclear waits for a person (NEEDS_REVIEW / NO_JOB),
//  - already-entered invoices are DUPLICATE, Lobos Civil-billed ones SKIPPED
//    (Ilies 24 Oct 2026: not counted).
// A plant-hire invoice is only added on its own when it can't double count a
// hire-register estimate: either it links to the item by contract number, or
// the job has no estimate from that supplier.
import { prisma } from "./prisma";
import { invoiceMimeOf, readInvoiceFile } from "./invoiceFiles";
import { readInvoiceSheet } from "./invoiceSheet";
import { mapSheetColumns, matchInvoiceRows, readInvoiceDocument, ReadingNotConfigured, type JobForMatching, type ReadInvoice } from "./invoiceReading";
import { readInvoice } from "./invoicedCosts";
import { todaySydney } from "./today";

export type DraftStatus = "ADDED" | "NEEDS_REVIEW" | "NO_JOB" | "DUPLICATE" | "SKIPPED";

// ---- small normalisers ------------------------------------------------------

export const normSite = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
// "INV-47770", "47770", "49104 (excavator part)" -> "47770" / "49104".
export function invoiceKey(no: string | null | undefined) {
  const first = (no ?? "").toUpperCase().replace(/^(TAX\s+)?(INVOICE|INV)[\s#:.-]*/, "").trim().split(/[\s(]/)[0] ?? "";
  return first.replace(/[^A-Z0-9]/g, "");
}
// First real word of a supplier name: "Allcott Hire" -> "allcott".
const vendorKey = (v: string | null | undefined) =>
  (v ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).find((w) => w && !["the", "a"].includes(w)) ?? "";
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function money(v: string | null | undefined): number | null {
  const t = (v ?? "").replace(/[$,\s]/g, "");
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[()-]/g, ""));
  return Number.isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : null;
}

// "30/09/2026", "2026-09-30", "30.9.26" -> "2026-09-30"; anything else -> null.
export function isoDate(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// ---- reading an upload --------------------------------------------------------

type Raw = {
  rowNo?: number; documentType?: ReadInvoice["documentType"];
  supplier: string | null; entityBilled: string | null; invoiceNo: string | null; invoiceDate: string | null;
  periodFrom: string | null; periodTo: string | null; description: string | null; siteText: string | null; hireRef: string | null;
  amountExGst: number | null; gst: number | null; totalIncGst: number | null;
  category: string | null; projectId: string | null; confidence: "HIGH" | "LOW" | null; matchReason: string | null;
};

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

async function jobsForMatching(): Promise<JobForMatching[]> {
  return prisma.project.findMany({
    where: { archived: false },
    select: { id: true, name: true, jobNo: true, quoteNo: true, client: true, address: true, status: true },
    orderBy: { name: "asc" },
  });
}

const conf = (c: string) => (c === "high" ? "HIGH" : c === "low" ? "LOW" : null);

async function rawFromDocument(fileName: string, jobs: JobForMatching[]): Promise<Raw[]> {
  const read = await readInvoiceDocument(await readInvoiceFile(fileName), invoiceMimeOf(fileName), jobs);
  return read.map((r) => ({
    documentType: r.documentType,
    supplier: blank(r.supplier), entityBilled: blank(r.entityBilled), invoiceNo: blank(r.invoiceNo),
    invoiceDate: isoDate(r.invoiceDate), periodFrom: isoDate(r.periodFrom), periodTo: isoDate(r.periodTo),
    description: blank(r.description), siteText: blank(r.siteText), hireRef: blank(r.hireRef),
    amountExGst: money(r.amountExGst), gst: money(r.gst), totalIncGst: money(r.totalIncGst),
    category: r.category, projectId: blank(r.projectId), confidence: conf(r.confidence), matchReason: blank(r.reason),
  }));
}

async function rawFromSheet(fileName: string, jobs: JobForMatching[]): Promise<Raw[]> {
  const table = await readInvoiceSheet(await readInvoiceFile(fileName), fileName);
  if (!table) throw new Error("No invoice list found in this spreadsheet.");
  const map = await mapSheetColumns(table.headers, table.rows.slice(0, 3).map((r) => r.cells));
  const get = (cells: Record<string, string>, f: keyof typeof map) => (map[f] ? blank(cells[map[f]]) : null);
  const rows: Raw[] = [];
  for (const r of table.rows) {
    const invoiceNo = get(r.cells, "invoiceNo");
    const amountExGst = money(get(r.cells, "amountExGst"));
    if (!invoiceNo && amountExGst == null) continue; // notes, blank lines
    if (!invoiceNo && !get(r.cells, "supplier")) continue; // a totals line
    const notes = get(r.cells, "notes");
    rows.push({
      rowNo: r.rowNo,
      supplier: get(r.cells, "supplier"), entityBilled: get(r.cells, "entityBilled"), invoiceNo,
      invoiceDate: isoDate(get(r.cells, "invoiceDate")), periodFrom: isoDate(get(r.cells, "periodFrom")), periodTo: isoDate(get(r.cells, "periodTo")),
      description: [get(r.cells, "description"), notes].filter(Boolean).join(" - ") || null,
      siteText: get(r.cells, "siteText"), hireRef: get(r.cells, "hireRef"),
      amountExGst, gst: money(get(r.cells, "gst")), totalIncGst: money(get(r.cells, "totalIncGst")),
      category: null, projectId: null, confidence: null, matchReason: null,
    });
  }
  // Only rows that could still be added are sent for matching - ones already
  // in Tracking, or billed to Lobos Civil, are settled by the rules alone.
  const existing = await existingInvoiceKeys();
  const aliases = await aliasMap();
  const toMatch = rows.filter((r) => !isCivil(r) && !existing.has(dupKey(r.supplier, r.invoiceNo)));
  for (let i = 0; i < toMatch.length; i += 60) {
    const batch = toMatch.slice(i, i + 60);
    const matches = await matchInvoiceRows(
      batch.map((r, k) => ({
        id: String(i + k), supplier: r.supplier ?? "", siteText: r.siteText ?? "", description: (r.description ?? "").slice(0, 160),
        knownJob: r.siteText ? aliases.get(normSite(r.siteText)) : undefined,
      })),
      jobs,
    );
    for (const m of matches) {
      const r = toMatch[Number(m.id)];
      if (!r) continue;
      r.projectId = blank(m.projectId); r.confidence = conf(m.confidence); r.category = m.category; r.matchReason = blank(m.reason);
    }
  }
  return rows;
}

// ---- the rules -----------------------------------------------------------------

const isCivil = (r: { entityBilled: string | null }) => /civil/i.test(r.entityBilled ?? "");
const dupKey = (supplier: string | null, invoiceNo: string | null) => `${vendorKey(supplier)}|${invoiceKey(invoiceNo)}`;

async function existingInvoiceKeys() {
  const rows = await prisma.invoicedCost.findMany({ select: { vendor: true, invoiceNo: true } });
  return new Set(rows.filter((r) => invoiceKey(r.invoiceNo)).map((r) => dupKey(r.vendor, r.invoiceNo)));
}

async function aliasMap() {
  return new Map((await prisma.siteAlias.findMany()).map((a) => [a.text, a.projectId]));
}

type Verdict = { status: DraftStatus; problem: string | null; hireResourceId?: string | null };

// Words accounts use when an invoice isn't settled yet ("check vs TIN89926 -
// possible duplicate", "FULLY CREDITED", "document is a quote").
const ACCOUNTS_FLAG = /\b(check|duplicate|credited|credit note|quote|query|queried|dispute[d]?|tbc|transferred)\b/i;
function noteAround(text: string, at: number) {
  const start = Math.max(0, text.lastIndexOf(" - ", at) + 3, at - 60);
  return text.slice(start, at + 70).trim();
}

function fiveMonthsAgo() {
  const d = new Date(`${todaySydney()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 5);
  return d.toISOString().slice(0, 10);
}

async function decide(r: Raw, seen: Set<string>, existing: Set<string>, jobIds: Set<string>): Promise<Verdict> {
  const key = dupKey(r.supplier, r.invoiceNo);
  const site = r.siteText ? `"${r.siteText}"` : "the site on it";
  if (r.documentType && !["invoice", "credit_note", "receipt"].includes(r.documentType)) {
    return { status: "NEEDS_REVIEW", problem: `This looks like a ${r.documentType.replace("_", " ")}, not an invoice.` };
  }
  if (isCivil(r)) return { status: "SKIPPED", problem: "Billed to Lobos Civil - not counted on Lobos Contracting jobs. Add it by hand if this one should count." };
  if (invoiceKey(r.invoiceNo) && (existing.has(key) || seen.has(key))) return { status: "DUPLICATE", problem: "Already entered." };
  if (!r.supplier || r.amountExGst == null || !r.invoiceDate) {
    const missing = [!r.supplier && "supplier", r.amountExGst == null && "amount", !r.invoiceDate && "invoice date"].filter(Boolean).join(", ");
    return { status: "NEEDS_REVIEW", problem: `Couldn't read the ${missing}.` };
  }
  // Ilies (24 Oct 2026): only jobs from the last five months and ongoing.
  if (r.invoiceDate < fiveMonthsAgo()) return { status: "SKIPPED", problem: "Older than five months - outside what Tracking covers." };
  if (r.entityBilled && !/lobos/i.test(r.entityBilled)) return { status: "NEEDS_REVIEW", problem: `Billed to ${r.entityBilled}, not Lobos - check it's ours.` };
  if (r.amountExGst < 0) return { status: "NEEDS_REVIEW", problem: "Credit note - check which invoice it reduces before adding it." };
  // Accounts write their doubts into the notes - respect them.
  const flagged = ACCOUNTS_FLAG.exec(r.description ?? "");
  if (flagged) return { status: "NEEDS_REVIEW", problem: `Accounts' note: "${noteAround(r.description ?? "", flagged.index)}"` };
  if (!r.projectId || !r.confidence || !jobIds.has(r.projectId)) {
    return { status: "NO_JOB", problem: `No job in Operations matches ${site}.` };
  }
  if (r.confidence !== "HIGH") return { status: "NEEDS_REVIEW", problem: `Not sure which job: ${r.matchReason ?? site}.` };
  if (!r.category || r.category === "OTHER") return { status: "NEEDS_REVIEW", problem: "Not sure what kind of cost this is." };

  if (r.category === "PLANT_HIRE") {
    const items = await prisma.resource.findMany({
      where: { type: "HIRE", hireProjectId: r.projectId, NOT: { category: "LABOUR" } },
      select: { id: true, name: true, agency: true, hireRef: true, onHireDate: true, offHireDate: true },
    });
    const ref = digits(r.hireRef);
    const byRef = ref ? items.find((i) => digits(i.hireRef) === ref) : undefined;
    if (byRef) {
      if (!r.periodFrom || !r.periodTo) return { status: "NEEDS_REVIEW", problem: `Bills the hire item "${byRef.name}" but the hire period couldn't be read - enter it so the estimate stops for those days.` };
      return { status: "ADDED", problem: null, hireResourceId: byRef.id };
    }
    const sameSupplier = items.find((i) => i.onHireDate && vendorKey(i.agency) && vendorKey(i.agency) === vendorKey(r.supplier));
    if (sameSupplier) return { status: "NEEDS_REVIEW", problem: `May be the same hire as the estimate for "${sameSupplier.name}" - link it to that item, or add it as separate.` };
  }
  return { status: "ADDED", problem: null };
}

// Puts a draft onto its job as an InvoicedCost (the same checks as the Add
// invoice form). Returns the new row's id, or an error.
async function addToTracking(
  d: { projectId: string | null; category: string | null; supplier: string | null; invoiceNo: string | null; invoiceDate: string | null;
       amountExGst: number | null; gst: number | null; periodFrom: string | null; periodTo: string | null; hireResourceId: string | null;
       description: string | null; siteText: string | null },
  source: string, enteredBy: string,
): Promise<{ id: string } | { error: string }> {
  const out = await readInvoice({
    projectId: d.projectId, category: d.category, vendor: d.supplier, invoiceNo: d.invoiceNo, weekEnding: d.invoiceDate,
    amountExGst: d.amountExGst, gst: d.gst ?? "", hireResourceId: d.hireResourceId, periodFrom: d.periodFrom, periodTo: d.periodTo,
    notes: [d.description, d.siteText && `Site: ${d.siteText}`, source].filter(Boolean).join(". "),
  });
  if ("error" in out) return out;
  const row = await prisma.invoicedCost.create({ data: { ...out.data, enteredBy } });
  return { id: row.id };
}

// Reads one upload and settles every invoice in it. Runs in the background;
// any failure marks the upload FAILED with a plain message.
export async function processUpload(uploadId: string) {
  const upload = await prisma.invoiceUpload.findUnique({ where: { id: uploadId } });
  if (!upload || upload.status !== "READING") return;
  try {
    const jobs = await jobsForMatching();
    const raws = upload.kind === "SHEET" ? await rawFromSheet(upload.fileName, jobs) : await rawFromDocument(upload.fileName, jobs);
    const existing = await existingInvoiceKeys();
    const jobIds = new Set(jobs.map((j) => j.id));
    const seen = new Set<string>();
    const source = `From ${upload.originalName}${upload.uploadedBy ? `, uploaded by ${upload.uploadedBy}` : ""} (invoices inbox)`;
    for (const r of raws) {
      const v = await decide(r, seen, existing, jobIds);
      let status = v.status, problem = v.problem, invoicedCostId: string | null = null;
      if (status === "ADDED") {
        const added = await addToTracking({ ...r, hireResourceId: v.hireResourceId ?? null }, source, "Invoices inbox (automatic)");
        if ("error" in added) [status, problem] = ["NEEDS_REVIEW", added.error];
        else invoicedCostId = added.id;
      }
      if (invoiceKey(r.invoiceNo)) seen.add(dupKey(r.supplier, r.invoiceNo));
      await prisma.invoiceDraft.create({
        data: {
          uploadId, rowNo: r.rowNo ?? null, supplier: r.supplier, entityBilled: r.entityBilled, invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate,
          periodFrom: r.periodFrom, periodTo: r.periodTo, description: r.description, siteText: r.siteText, hireRef: r.hireRef,
          amountExGst: r.amountExGst, gst: r.gst, totalIncGst: r.totalIncGst, category: r.category, projectId: r.projectId,
          hireResourceId: v.hireResourceId ?? null, confidence: r.confidence, matchReason: r.matchReason,
          status, problem, invoicedCostId, autoAdded: status === "ADDED",
        },
      });
    }
    await prisma.invoiceUpload.update({
      where: { id: uploadId },
      data: { status: "DONE", finishedAt: new Date(), error: raws.length ? null : "No invoices found in this file." },
    });
  } catch (e) {
    // Our own messages are written for accounts; anything else (network,
    // the reading service) gets a plain one, with the detail in the server log.
    const msg = (e as Error).message ?? "";
    const plain = e instanceof ReadingNotConfigured || /^(No invoice list|The file couldn't)/.test(msg) ? msg : "Couldn't read the file this time - try again in a minute.";
    if (plain !== msg) console.error("invoice inbox: reading failed", uploadId, msg);
    await prisma.invoiceUpload.update({
      where: { id: uploadId },
      data: { status: "FAILED", finishedAt: new Date(), error: plain.slice(0, 300) },
    });
  }
}

export function processInBackground(uploadId: string) {
  processUpload(uploadId).catch(() => undefined);
}

// ---- a person deciding ------------------------------------------------------------

export type DraftAction =
  | { action: "ADD"; fields: Record<string, unknown> }
  | { action: "SKIP"; reason?: string }
  | { action: "UNDO" };

const FIELD_KEYS = ["projectId", "category", "supplier", "invoiceNo", "invoiceDate", "amountExGst", "gst", "periodFrom", "periodTo", "hireResourceId", "description"] as const;

export async function decideDraft(draftId: string, act: DraftAction, by: string): Promise<{ error: string } | { ok: true }> {
  const d = await prisma.invoiceDraft.findUnique({ where: { id: draftId }, include: { upload: { select: { originalName: true } } } });
  if (!d) return { error: "That invoice isn't in the inbox any more." };

  if (act.action === "UNDO") {
    if (d.status !== "ADDED") return { error: "It isn't on a job." };
    if (d.invoicedCostId) await prisma.invoicedCost.deleteMany({ where: { id: d.invoicedCostId } });
    await prisma.invoiceDraft.update({
      where: { id: d.id },
      data: { status: "NEEDS_REVIEW", invoicedCostId: null, problem: `Taken off the job by ${by} - decide again.`, decidedBy: by, decidedAt: new Date() },
    });
    return { ok: true };
  }
  if (d.status === "ADDED") return { error: "It's already on a job - take it off first." };

  if (act.action === "SKIP") {
    await prisma.invoiceDraft.update({
      where: { id: d.id },
      data: { status: "SKIPPED", problem: (act.reason ?? "").trim().slice(0, 200) || `Not a job cost (${by}).`, decidedBy: by, decidedAt: new Date() },
    });
    return { ok: true };
  }

  // ADD: the person's corrections win over what was read.
  const f = act.fields;
  const pick = (k: (typeof FIELD_KEYS)[number]) => (k in f ? (f[k] === "" ? null : f[k]) : (d as Record<string, unknown>)[k]);
  const merged = Object.fromEntries(FIELD_KEYS.map((k) => [k, pick(k)])) as Record<(typeof FIELD_KEYS)[number], unknown>;
  const added = await addToTracking(
    {
      projectId: merged.projectId as string | null, category: merged.category as string | null, supplier: merged.supplier as string | null,
      invoiceNo: merged.invoiceNo as string | null, invoiceDate: merged.invoiceDate as string | null,
      amountExGst: merged.amountExGst == null ? null : Number(merged.amountExGst), gst: merged.gst == null ? null : Number(merged.gst),
      periodFrom: merged.periodFrom as string | null, periodTo: merged.periodTo as string | null, hireResourceId: merged.hireResourceId as string | null,
      description: merged.description as string | null, siteText: d.siteText,
    },
    `From ${d.upload.originalName} (invoices inbox), matched by ${by}`,
    by,
  );
  if ("error" in added) return added;
  await prisma.invoiceDraft.update({
    where: { id: d.id },
    data: {
      ...Object.fromEntries(FIELD_KEYS.map((k) => [k, k === "amountExGst" || k === "gst" ? (merged[k] == null ? null : Number(merged[k])) : merged[k]])),
      status: "ADDED", problem: null, invoicedCostId: added.id, autoAdded: false, decidedBy: by, decidedAt: new Date(),
    },
  });
  // Remember how accounts write this site, so the next upload matches it.
  if (d.siteText && merged.projectId) {
    const text = normSite(d.siteText);
    await prisma.siteAlias.upsert({ where: { text }, update: { projectId: merged.projectId as string, createdBy: by }, create: { text, projectId: merged.projectId as string, createdBy: by } });
  }
  return { ok: true };
}
