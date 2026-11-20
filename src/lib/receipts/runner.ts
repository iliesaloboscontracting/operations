// Receipts R2 - reading in the background. A receipt or odometer photo is read straight after it's
// sent, and the server's one-minute tick (instrumentation.ts) picks up anything still waiting (up to
// 3 tries each). Kill switch RECEIPT_READING=off: nothing is read and no outbound call is made -
// receipts simply stay "waiting to be read". A reading only ever lands on a row that's still SENT,
// so it never overwrites what a person has done. Rules: ./checks.ts. Reader: ./reading.ts.
import { prisma } from "../prisma";
import { ReadingNotConfigured } from "../invoiceReading";
import { readReceiptPhoto, receiptMimeOf } from "./files";
import { claudeReader, type Photo, type ReadContext, type Reader } from "./reading";
import { decideFuel, decideOdometer, decidePurchase, decideTip, docketDate, fuelFields, hasClockTime, normDocket, purchaseFields, tipFields, type Decision } from "./checks";
import { jobForDocket } from "./batchRules";
import { senderCheck } from "./senderStore";
import { claimFromOwnReceipt } from "../reimbursements/store";
import { syncTipMatchesSoon, truckRegos, vehicleForRego } from "./tipStore";

export const readingEnabled = () => process.env.RECEIPT_READING !== "off";
export const MAX_TRIES = 3;

export type ReadingLog = {
  result?: unknown; reasons?: string[]; readAt?: string; tries?: number; lastError?: string;
  corrections?: { at: string; by: string; field: string; before: unknown; after: unknown }[];
  rejected?: { at: string; by: string; reason: string };
  added?: { at: string; by: string; fromReceiptId: string }; // a second docket typed in from another receipt's photo
};
export const logOf = (s: string | null | undefined): ReadingLog => { try { return s ? (JSON.parse(s) as ReadingLog) : {}; } catch { return {}; } };

// DB-002: the "being read" set and the tip lock live on globalThis - every route bundle (the phone link's, /receipts',
// the batch upload's) and the instrumentation tick load their own copy of this module, and must share one of each.
const shared = globalThis as unknown as { __receiptInFlight?: Set<string>; __tipChain?: Promise<unknown> };
const inFlight = (shared.__receiptInFlight ??= new Set<string>());

async function photosOf(rows: { fileName: string }[]): Promise<Photo[]> {
  return Promise.all(rows.map(async (p) => ({ data: await readReceiptPhoto(p.fileName), mime: receiptMimeOf(p.fileName) as Photo["mime"] })));
}

async function context(): Promise<ReadContext & { trucks: { id: string; rego: string }[] }> {
  const [list, sites, rateSites] = await Promise.all([
    truckRegos(),
    prisma.receipt.findMany({ where: { kind: "TIP", status: { in: ["READ", "CONFIRMED"] }, tipSite: { not: null }, sentAt: { gte: new Date(Date.now() - 180 * 86_400_000) } }, select: { tipSite: true }, distinct: ["tipSite"], take: 60 }),
    // The tip-rate list's site names too (R3), so the reader spells a site the way its rate does.
    prisma.tipRate.findMany({ where: { retiredAt: null }, select: { tipSite: true }, distinct: ["tipSite"], take: 60 }),
  ]);
  const tipSites = [...new Set([...rateSites.map((s) => s.tipSite), ...sites.map((s) => s.tipSite!)].filter(Boolean))];
  return { trucks: list, regos: list.map((t) => t.rego), tipSites };
}

async function failed(kind: "receipt" | "odometer", id: string, prior: ReadingLog, e: unknown) {
  if (e instanceof ReadingNotConfigured) return; // no call was made - try again once it's set up
  const log: ReadingLog = { ...prior, tries: (prior.tries ?? 0) + 1, lastError: "Couldn't read it this time" };
  console.error(`receipts: reading ${kind} ${id} failed`, e instanceof Error ? e.message : "error");
  if (kind === "receipt") await prisma.receipt.updateMany({ where: { id, status: "SENT" }, data: { reading: JSON.stringify(log) } });
  else await prisma.odometerReading.updateMany({ where: { id, status: "SENT" }, data: { reading: JSON.stringify(log) } });
}

// Who was on the truck (Ilies, 10 Nov 2026): a docket or fuel receipt naming one of our trucks, sent on the link of
// someone who wasn't signed in on it while others were, is To check with a note (./senderStore.ts, ./checks.ts).
async function withSender(d: Decision, r: { kind: string; sentByResourceId: string | null; sentBy: string; sentAt: Date }, f: { vehicleId: string | null; docketAt: Date | null }): Promise<Decision> {
  const hit = await senderCheck({ kind: r.kind, sentByResourceId: r.sentByResourceId, sentBy: r.sentBy, sentAt: r.sentAt, docketAt: f.docketAt, vehicleId: f.vehicleId });
  return hit ? { status: "CHECK", reasons: [...d.reasons, hit.reason] } : d;
}

async function save(r: { id: string; kind: string; ownMoney: boolean }, data: Record<string, unknown>, decision: Decision) {
  const saved = await prisma.receipt.updateMany({ where: { id: r.id, status: "SENT" }, data: { ...data, status: decision.status, checkReasons: JSON.stringify(decision.reasons) } });
  // A tip docket that now counts may be one an invoice already bills (R3).
  if (saved.count && r.kind === "TIP" && decision.status === "READ") syncTipMatchesSoon();
  // "I paid this myself" from a phone: a clean reading becomes the claim for accounts.
  if (saved.count && r.ownMoney && decision.status === "READ") await claimFromOwnReceipt(r.id);
}

// One tip docket at a time between "is this docket number already in?" and saving (on globalThis - DB-002).
shared.__tipChain ??= Promise.resolve();
function tipLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = (shared.__tipChain ?? Promise.resolve()).then(fn, fn);
  shared.__tipChain = run.catch(() => undefined);
  return run;
}

// The job an office-batch docket goes on, from the date read off it (rule: ./batchRules.ts jobForDocket).
async function batchJob(projectId: string, dateTime: string) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec((dateTime ?? "").trim());
  if (!m || !docketDate(dateTime)) return { jobId: null, note: null };
  const day = m[1];
  const from = new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000);
  const jobs = await prisma.job.findMany({ where: { projectId, cancelledAt: null, date: { gte: from, lte: new Date(`${day}T00:00:00Z`) } }, select: { id: true, date: true, shift: true } });
  return jobForDocket(jobs.map((j) => ({ id: j.id, day: j.date.toISOString().slice(0, 10), shift: j.shift })), { day, time: m[2] ?? null });
}

export async function readReceipt(id: string, reader: Reader = claudeReader): Promise<void> {
  if (!readingEnabled() || inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const r = await prisma.receipt.findUnique({ where: { id }, include: { photos: { orderBy: { createdAt: "asc" } } } });
    if (!r || r.status !== "SENT" || !r.photos.length) return;
    const prior = logOf(r.reading);
    if ((prior.tries ?? 0) >= MAX_TRIES) return;
    try {
      const [photos, ctx] = await Promise.all([photosOf(r.photos), context()]);
      let data: Record<string, unknown>, decision: Decision;
      if (r.kind === "TIP") {
        const x = await reader.tip(photos, ctx);
        // Looking for the same docket number and saving happen one docket at a time (tipLock), so two photos of one
        // docket read side by side (an office batch, or two phones) can't both miss each other.
        await tipLock(async () => {
          const fields = tipFields(x);
          const key = normDocket(fields.docketNo);
          const earlier = key
            ? (await prisma.receipt.findMany({ where: { kind: "TIP", id: { not: r.id }, docketNo: { not: null }, status: { not: "REJECTED" }, sentAt: { gte: new Date(Date.now() - 400 * 86_400_000) } }, select: { docketNo: true, sentBy: true, sentAt: true } }))
                .find((o) => normDocket(o.docketNo) === key)
            : undefined;
          // An office batch: the job from the docket's date (batchRules.jobForDocket) - never moves a job already set.
          const pick = r.officeBatchId && !r.jobId && r.projectId ? await batchJob(r.projectId, x.dateTime) : null;
          const first = decideTip(x, {
            sentAt: r.sentAt, asbestosTap: r.asbestos, ourRegos: ctx.regos, officeBatch: !!r.officeBatchId, jobNote: pick?.note ?? null,
            duplicateOf: earlier ? `by ${earlier.sentBy} on ${earlier.sentAt.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}` : null,
          });
          // The docket's rego, when it's one of our trucks, links it to that truck (R3; R4 uses it).
          const vehicleId = vehicleForRego(fields.rego, ctx.trucks);
          const tipDecision = await withSender(first, r, { vehicleId: vehicleId ?? r.vehicleId, docketAt: hasClockTime(x.dateTime) ? fields.docketAt : null });
          const tipData = { ...fields, ...(vehicleId ? { vehicleId } : {}), ...(pick?.jobId ? { jobId: pick.jobId } : {}), reading: JSON.stringify({ ...prior, result: x, reasons: tipDecision.reasons, readAt: new Date().toISOString(), tries: (prior.tries ?? 0) + 1, lastError: undefined }) };
          await save(r, tipData, tipDecision);
        });
        return;
      } else if (r.kind === "PURCHASE") {
        const x = await reader.purchase(photos);
        decision = decidePurchase(x, { sentAt: r.sentAt });
        data = { ...purchaseFields(x), reading: JSON.stringify({ ...prior, result: x, reasons: decision.reasons, readAt: new Date().toISOString(), tries: (prior.tries ?? 0) + 1, lastError: undefined }) };
      } else {
        const x = await reader.fuel(photos, ctx);
        const picked = ctx.trucks.find((t) => t.id === r.vehicleId)?.rego ?? null;
        decision = decideFuel(x, { sentAt: r.sentAt, ourRegos: ctx.regos, pickedRego: picked });
        const fuel = fuelFields(x);
        decision = await withSender(decision, r, { vehicleId: r.vehicleId, docketAt: hasClockTime(x.dateTime) ? fuel.docketAt : null });
        data = { ...fuel, reading: JSON.stringify({ ...prior, result: x, reasons: decision.reasons, readAt: new Date().toISOString(), tries: (prior.tries ?? 0) + 1, lastError: undefined }) };
      }
      await save(r, data, decision);
    } catch (e) {
      await failed("receipt", r.id, prior, e);
    }
  } finally {
    inFlight.delete(id);
  }
}

export async function readOdometer(id: string, reader: Reader = claudeReader): Promise<void> {
  const key = `odo:${id}`;
  if (!readingEnabled() || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const o = await prisma.odometerReading.findUnique({ where: { id }, include: { photos: { orderBy: { createdAt: "desc" }, take: 1 } } });
    if (!o || o.status !== "SENT" || !o.photos.length) return;
    const prior = logOf(o.reading);
    if ((prior.tries ?? 0) >= MAX_TRIES) return;
    try {
      const [photo] = await photosOf(o.photos);
      const x = await reader.odometer(photo);
      const prev = await prisma.odometerReading.findFirst({ where: { vehicleId: o.vehicleId, id: { not: o.id }, km: { not: null }, status: { in: ["READ", "CONFIRMED"] }, sentAt: { lt: o.sentAt } }, orderBy: { sentAt: "desc" }, select: { km: true, sentAt: true } });
      const decision = decideOdometer(x, { sentAt: o.sentAt, previous: prev ? { km: prev.km!, at: prev.sentAt } : null });
      const km = Number(String(x.km).replace(/[^\d]/g, "")) || null;
      await prisma.odometerReading.updateMany({
        where: { id: o.id, status: "SENT" },
        data: { km, status: decision.status, reading: JSON.stringify({ ...prior, result: x, reasons: decision.reasons, readAt: new Date().toISOString(), tries: (prior.tries ?? 0) + 1, lastError: undefined }) },
      });
    } catch (e) {
      await failed("odometer", o.id, prior, e);
    }
  } finally {
    inFlight.delete(key);
  }
}

// Straight after a phone sends it - never holds the phone up.
export const readReceiptSoon = (id: string) => { readReceipt(id).catch(() => undefined); };
export const readOdometerSoon = (id: string) => { readOdometer(id).catch(() => undefined); };

// The one-minute tick: anything still waiting (sent over a minute ago, under 3 tries), a few at a time.
// DB-004: rows that used up their three tries stay SENT ("couldn't be read") - the search pages past them (oldest
// first, 40 at a time, at most SCAN_BOUND rows looked at), so a pile of used-up ones never hides a fresh one.
export const SCAN_BOUND = 500;
type Row = { id: string; reading: string | null };
export async function pagedDue(page: (cursor: string | null) => Promise<Row[]>, want: number): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | null = null;
  for (let seen = 0; seen < SCAN_BOUND && out.length < want; ) {
    const rows = await page(cursor);
    if (!rows.length) break;
    seen += rows.length;
    for (const r of rows) if ((logOf(r.reading).tries ?? 0) < MAX_TRIES && out.length < want) out.push(r.id);
    cursor = rows[rows.length - 1].id;
    if (rows.length < 40) break;
  }
  return out;
}
const pageArgs = (cursor: string | null) => ({ select: { id: true, reading: true }, orderBy: [{ sentAt: "asc" as const }, { id: "asc" as const }], take: 40, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
// SENT receipts still under three tries, oldest first. `where` narrows it (e.g. office batches only).
export const dueReceipts = (where: Record<string, unknown>, want: number) =>
  pagedDue((cursor) => prisma.receipt.findMany({ where: { ...where, status: "SENT" }, ...pageArgs(cursor) }), want);

export async function readWaiting(reader: Reader = claudeReader, max = 5): Promise<number> {
  if (!readingEnabled()) return 0;
  const before = new Date(Date.now() - 60_000);
  const [receipts, odos] = await Promise.all([
    dueReceipts({ sentAt: { lt: before } }, max),
    pagedDue((cursor) => prisma.odometerReading.findMany({ where: { status: "SENT", sentAt: { lt: before } }, ...pageArgs(cursor) }), max),
  ]);
  const due = [...receipts.map((id) => () => readReceipt(id, reader)), ...odos.map((id) => () => readOdometer(id, reader))].slice(0, max);
  for (const run of due) await run();
  return due.length;
}
