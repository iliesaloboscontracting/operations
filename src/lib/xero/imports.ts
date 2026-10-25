// Xero exports in and out of the database (G2, 25 Oct 2026). An upload is
// saved like an invoice file (INVOICE_FILE_DIR, in the nightly backup), read
// (readers.ts), matched to jobs (match.ts) and written as one XeroImport with
// its rows in a single transaction. A file that can't be read is kept as a
// FAILED import with the reason and adds no rows. "Current" = the latest
// DONE import of each kind. The only rows ever changed afterwards are the
// job-match fields, when a person decides (XeroJobMatch). Server-only.
import { prisma } from "../prisma";
import { readInvoiceFile, saveInvoiceFile } from "../invoiceFiles";
import { readSheetGrids } from "../invoiceSheet";
import { todaySydney } from "../today";
import type { AuthUser } from "../auth";
import { readInvoiceGrid, readPnlGrid, type ReadInvoice, type ReadPnlLine } from "./readers";
import { matchInvoice, matchKey, suggestionOf, type MatchContext } from "./match";
import { cashTile, needsReview, pnlSummary, revenueSummary, revenueTile } from "./summary";

export const XERO_KINDS = ["INVOICES", "BILLS", "PNL"] as const;
export type XeroKind = (typeof XERO_KINDS)[number];
export const KIND_LABEL: Record<XeroKind, string> = { INVOICES: "Sales invoices", BILLS: "Bills", PNL: "Profit and Loss" };

async function matchContext(): Promise<MatchContext> {
  const [projects, aliases, person] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true, jobNo: true, quoteNo: true, address: true } }),
    prisma.siteAlias.findMany({ select: { text: true, projectId: true } }),
    prisma.xeroJobMatch.findMany({ select: { key: true, projectId: true } }),
  ]);
  return { projects, aliases, person: new Map(person.map((p) => [p.key, p.projectId])) };
}

export async function importXeroFile(
  body: { dataUrl?: unknown; originalName?: unknown; kind?: unknown; asAt?: unknown },
  user: AuthUser,
): Promise<{ error: string; status: number } | { id: string; status: "DONE" | "FAILED"; rows: number; error: string | null }> {
  const kind = String(body.kind ?? "") as XeroKind;
  if (!XERO_KINDS.includes(kind)) return { error: "Choose what the file is: sales invoices, bills, or Profit and Loss.", status: 400 };
  const today = todaySydney();
  const asAt = typeof body.asAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asAt) ? body.asAt : today;
  if (asAt > today) return { error: "The export date can't be in the future.", status: 400 };
  const name = typeof body.originalName === "string" ? body.originalName : "";
  if (!/\.(csv|xlsx)$/i.test(name)) return { error: "Upload the Xero export as .csv or .xlsx.", status: 400 };
  const saved = await saveInvoiceFile(body.dataUrl, name);
  if ("error" in saved) return { error: saved.error, status: 400 };

  const imp = await prisma.xeroImport.create({
    data: { source: "UPLOAD", kind, fileName: saved.fileName, originalName: name.slice(0, 200), asAt, uploadedBy: user.name, byUserId: user.id },
  });
  const fail = async (error: string) => {
    await prisma.xeroImport.update({ where: { id: imp.id }, data: { status: "FAILED", error, finishedAt: new Date() } });
    return { id: imp.id, status: "FAILED" as const, rows: 0, error };
  };
  try {
    const grids = await readSheetGrids(await readInvoiceFile(saved.fileName), saved.fileName);
    if (kind === "PNL") {
      let firstError = "The file is empty.";
      for (const g of grids) {
        const r = readPnlGrid(g.grid);
        if ("error" in r) { firstError = r.error; continue; }
        await writePnl(imp.id, r.lines, r.months);
        return { id: imp.id, status: "DONE", rows: r.lines.length, error: null };
      }
      return fail(firstError);
    }
    let invoices: ReadInvoice[] | null = null;
    let firstError = "The file is empty.";
    for (const g of grids) {
      const r = readInvoiceGrid(g.grid, kind);
      if ("error" in r) { firstError = r.error; continue; }
      invoices = r.invoices;
      break;
    }
    if (!invoices) return fail(firstError);
    await writeInvoices(imp.id, invoices);
    return { id: imp.id, status: "DONE", rows: invoices.length, error: null };
  } catch (e) {
    console.error("xero import", e instanceof Error ? e.message : "unknown error");
    return fail("The file couldn't be read - is it the Xero export, saved as .csv or .xlsx?");
  }
}

// Writes read invoices (an upload, or a live sync with Xero ids) into an
// import in one transaction, matched to jobs, and marks it DONE.
export async function writeInvoices(importId: string, invoices: (ReadInvoice & { xeroId?: string | null })[]) {
  const ctx = await matchContext();
  const dates = invoices.map((i) => i.date).sort();
  await prisma.$transaction(async (tx) => {
    for (const i of invoices) {
      const m = matchInvoice(i, ctx);
      await tx.xeroInvoice.create({
        data: {
          importId, xeroId: i.xeroId ?? null, type: i.type, number: i.number, reference: i.reference, contact: i.contact, date: i.date, dueDate: i.dueDate,
          status: i.status, totalExGst: i.totalExGst, gst: i.gst, amountPaid: i.amountPaid, amountDue: i.amountDue,
          projectId: m.projectId, matchMethod: m.method, matchNote: m.note,
          lines: { create: i.lines.map((l, n) => ({ ...l, projectId: m.lines[n].projectId, matchMethod: m.lines[n].method })) },
        },
      });
    }
    await tx.xeroImport.update({ where: { id: importId }, data: { status: "DONE", rows: invoices.length, periodFrom: dates[0] ?? null, periodTo: dates[dates.length - 1] ?? null, finishedAt: new Date() } });
  }, { timeout: 120_000 });
}

export async function writePnl(importId: string, lines: ReadPnlLine[], months: string[]) {
  await prisma.$transaction([
    prisma.xeroPnlLine.createMany({ data: lines.map((l) => ({ importId, ...l })) }),
    prisma.xeroImport.update({ where: { id: importId }, data: { status: "DONE", rows: lines.length, periodFrom: months[0], periodTo: months[months.length - 1], finishedAt: new Date() } }),
  ]);
}

export function currentImport(kind: XeroKind) {
  return prisma.xeroImport.findFirst({ where: { kind, status: "DONE" }, orderBy: { createdAt: "desc" } });
}

export function recentImports() {
  return prisma.xeroImport.findMany({
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, kind: true, status: true, error: true, originalName: true, asAt: true, periodFrom: true, periodTo: true, rows: true, uploadedBy: true, createdAt: true },
  });
}

// Sales invoices in the current upload a person still needs to tie to a job.
export async function reviewList() {
  const cur = await currentImport("INVOICES");
  if (!cur) return { asAt: null, invoices: [] };
  const rows = await prisma.xeroInvoice.findMany({
    where: { importId: cur.id, type: { in: ["SALE", "SALE_CREDIT"] }, matchMethod: { in: ["NONE", "SITE_TEXT", "MIXED"] } },
    include: { lines: { select: { id: true, description: true, amountExGst: true, tracking1: true, tracking2: true, projectId: true, matchMethod: true } } },
    orderBy: [{ date: "desc" }, { number: "asc" }],
  });
  return { asAt: cur.asAt, invoices: rows.filter(needsReview).map((r) => ({ ...r, key: matchKey(r.type, r.number), suggest: suggestionOf(r.matchNote) })) };
}

// A person ties an invoice to a job (or says it isn't one). Remembered for
// every later upload, and applied to the current one straight away.
export async function decideMatch(body: { key?: unknown; projectId?: unknown; note?: unknown }, user: AuthUser): Promise<{ error: string; status: number } | { ok: true; updated: number }> {
  const key = typeof body.key === "string" ? body.key.trim().toUpperCase() : "";
  if (!/^(SALE|SALE_CREDIT|BILL|BILL_CREDIT)\|.{1,60}$/.test(key)) return { error: "Bad invoice key.", status: 400 };
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return { error: "That job doesn't exist.", status: 400 };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null;
  const [type, number] = [key.split("|")[0], key.slice(key.indexOf("|") + 1)];
  const cur = await currentImport(type.startsWith("BILL") ? "BILLS" : "INVOICES");
  return prisma.$transaction(async (tx) => {
    await tx.xeroJobMatch.upsert({
      where: { key },
      create: { key, projectId, note, by: user.name, byUserId: user.id },
      update: { projectId, note, by: user.name, byUserId: user.id, at: new Date() },
    });
    if (!cur) return { ok: true as const, updated: 0 };
    const rows = (await tx.xeroInvoice.findMany({ where: { importId: cur.id, type }, select: { id: true, number: true } }))
      .filter((r) => r.number.trim().toUpperCase() === number);
    for (const r of rows) {
      await tx.xeroInvoice.update({ where: { id: r.id }, data: { projectId, matchMethod: "PERSON", matchNote: projectId ? note : "Not a job" } });
      await tx.xeroLine.updateMany({ where: { invoiceId: r.id }, data: { projectId, matchMethod: "PERSON" } });
    }
    return { ok: true as const, updated: rows.length };
  });
}

// Figures for the Directors health band and the "not tied to a job" finding.
export async function loadXeroHealth(today: string) {
  const [inv, pnl] = await Promise.all([currentImport("INVOICES"), currentImport("PNL")]);
  const invRows = inv
    ? await prisma.xeroInvoice.findMany({
        where: { importId: inv.id },
        select: { type: true, status: true, date: true, dueDate: true, totalExGst: true, amountDue: true, matchMethod: true, lines: { select: { amountExGst: true, projectId: true, matchMethod: true } } },
      })
    : [];
  const pnlRows = pnl ? await prisma.xeroPnlLine.findMany({ where: { importId: pnl.id }, select: { month: true, section: true, account: true, amount: true } }) : [];
  const info = (i: { asAt: string | null; uploadedBy: string | null; createdAt: Date; source: string }) => ({ asAt: i.asAt, uploadedBy: i.uploadedBy, createdAt: i.createdAt.toISOString(), source: i.source });
  const invS = inv ? { info: info(inv), s: revenueSummary(invRows, today) } : null;
  const pnlS = pnl ? { info: info(pnl), s: pnlSummary(pnlRows) } : null;
  return { revenue: revenueTile(invS, pnlS), cash: cashTile(invS), invoices: invS ? { asAt: inv!.asAt, ...invS.s } : null };
}
