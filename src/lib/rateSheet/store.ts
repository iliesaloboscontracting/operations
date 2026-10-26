// Agreed rates (Accounts stage 4, docs/accounts/STAGE4-DESIGN.md): reads Estimating's rate sheet server-side
// (contract rate-sheet.v1, the ACTUALS_SECRET key - never from a browser) and compares invoice lines from the
// invoices inbox with it. Nothing is copied: rates stay in Estimating. Accounts screen only.
import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { estimatingCall } from "@/lib/estimatingClient";
import { latestFlagReviews } from "@/lib/invoiceFlagReviews";
import { checkRate, isRateSheet, lineKey, matchLine, parseLines, supplierKey, type RateSheet, type SheetRate } from "./rules";

type Problem = { error: string; status: number };
export type SheetState = { ok: true; sheet: RateSheet; from: "ESTIMATING" | "FIXTURE" } | { ok: false; reason: string };

let cache: { at: number; state: SheetState } | null = null;

// The rate sheet: Estimating's /api/rate-sheet, or RATE_SHEET_FIXTURE (a JSON file, testing only). Cached 5 min.
export async function readRateSheet(): Promise<SheetState> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.state;
  let state: SheetState;
  const fixture = process.env.RATE_SHEET_FIXTURE;
  if (fixture) {
    try {
      const v = JSON.parse(await fs.readFile(fixture, "utf8"));
      state = isRateSheet(v) ? { ok: true, sheet: v, from: "FIXTURE" } : { ok: false, reason: "The test rate sheet isn't in the rate-sheet.v1 shape." };
    } catch { state = { ok: false, reason: "The test rate sheet couldn't be read." }; }
  } else {
    const key = process.env.ACTUALS_SECRET;
    if (!key || key.length < 16) state = { ok: false, reason: "The server key for Estimating isn't set." };
    else {
      const r = await estimatingCall<RateSheet>("/api/rate-sheet?category=Plant,Plant attachments,Trucks,Access / EWP,Skip bins,Disposal", { headers: { "x-lobos-actuals": key } });
      state =
        r.status === 0 ? { ok: false, reason: "Estimating isn't reachable right now." }
        : r.status === 404 ? { ok: false, reason: "Rate sheet not available from Estimating yet." }
        : r.status === 403 ? { ok: false, reason: "Estimating refused the server key." }
        : r.status !== 200 || !isRateSheet(r.body) ? { ok: false, reason: "Estimating's rate sheet came back in an unexpected shape." }
        : { ok: true, sheet: r.body, from: "ESTIMATING" };
    }
  }
  cache = { at: Date.now(), state };
  return state;
}
export const clearRateSheetCache = () => { cache = null; };

const rateLabel = (r: SheetRate) => `${r.supplier} - ${r.item} (${r.unit})`;

// Every priced line on inbox invoices from the last 120 days, matched to the agreed rate and checked.
export async function overRateView() {
  const sheet = await readRateSheet();
  const drafts = await prisma.invoiceDraft.findMany({
    where: { lines: { not: null }, createdAt: { gte: new Date(Date.now() - 120 * 86_400_000) }, status: { notIn: ["DUPLICATE"] } },
    select: { id: true, supplier: true, invoiceNo: true, invoiceDate: true, category: true, status: true, lines: true, upload: { select: { originalName: true } } },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  const links = new Map((await prisma.rateLink.findMany()).map((l) => [`${l.supplierKey}|${l.lineKey}`, l.rateId]));
  const reviews = await latestFlagReviews("RATE");
  const over: unknown[] = [], toMatch: unknown[] = [];
  let ok = 0;
  if (sheet.ok) {
    for (const d of drafts) {
      parseLines(d.lines).forEach((line, i) => {
        const base = { draftId: d.id, lineNo: i, subjectId: `${d.id}:${i}`, supplier: d.supplier, invoiceNo: d.invoiceNo, invoiceDate: d.invoiceDate, file: d.upload.originalName, line };
        if (line.unitPriceExGst == null) return;
        const m = matchLine(line, d.supplier, sheet.sheet.rates, links);
        if (m.how === "NONE") {
          if (m.candidates.length) toMatch.push({ ...base, reason: m.reason, candidates: m.candidates.map((c) => ({ id: c.id, label: rateLabel(c), rateExGst: c.rateExGst })) });
          return;
        }
        const c = checkRate(line, m.rate, d.invoiceDate);
        if (!c) return;
        if (c.over) over.push({ ...base, how: m.how, rate: { id: m.rate.id, label: rateLabel(m.rate), rateExGst: m.rate.rateExGst }, check: c, review: reviews.get(`${d.id}:${i}|OVER_RATE`) ?? null });
        else ok++;
      });
    }
  }
  return {
    sheet: sheet.ok ? { ok: true as const, from: sheet.from, rates: sheet.sheet.rates.length, version: sheet.sheet.version } : { ok: false as const, reason: sheet.reason },
    over, toMatch, ok,
    openOver: over.filter((o) => (o as { review: { status: string } | null }).review?.status !== "OK").length,
  };
}

// Accounts pick / confirm the agreed rate for a line - remembered for this supplier's wording of the item.
export async function linkRate(by: string, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const sheet = await readRateSheet();
  if (!sheet.ok) return { error: sheet.reason, status: 503 };
  const d = await prisma.invoiceDraft.findUnique({ where: { id: String(b.draftId ?? "") }, select: { supplier: true, lines: true } });
  const line = d ? parseLines(d.lines)[Number(b.lineNo)] : undefined;
  const rate = sheet.sheet.rates.find((r) => r.id === b.rateId);
  if (!d || !line) return { error: "That invoice line isn't there any more.", status: 404 };
  if (!rate) return { error: "Pick a rate from the list.", status: 400 };
  const supplierK = supplierKey(d.supplier), lineK = lineKey(line.description);
  if (!supplierK || !lineK) return { error: "The invoice has no supplier or line description to remember.", status: 400 };
  await prisma.rateLink.upsert({
    where: { supplierKey_lineKey: { supplierKey: supplierK, lineKey: lineK } },
    update: { rateId: rate.id, label: rateLabel(rate), createdBy: by },
    create: { supplierKey: supplierK, lineKey: lineK, rateId: rate.id, label: rateLabel(rate), createdBy: by },
  });
  return { ok: true };
}
