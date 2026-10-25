// Receipts R2 - reading in the background. A receipt or odometer photo is read straight after it's
// sent, and the server's one-minute tick (instrumentation.ts) picks up anything still waiting (up to
// 3 tries each). Kill switch RECEIPT_READING=off: nothing is read and no outbound call is made -
// receipts simply stay "waiting to be read". A reading only ever lands on a row that's still SENT,
// so it never overwrites what a person has done. Rules: ./checks.ts. Reader: ./reading.ts.
import { prisma } from "../prisma";
import { ReadingNotConfigured } from "../invoiceReading";
import { readReceiptPhoto, receiptMimeOf } from "./files";
import { claudeReader, type Photo, type ReadContext, type Reader } from "./reading";
import { decideFuel, decideOdometer, decideTip, fuelFields, normDocket, tipFields } from "./checks";
import { syncTipMatchesSoon, truckRegos, vehicleForRego } from "./tipStore";

export const readingEnabled = () => process.env.RECEIPT_READING !== "off";
export const MAX_TRIES = 3;

export type ReadingLog = {
  result?: unknown; reasons?: string[]; readAt?: string; tries?: number; lastError?: string;
  corrections?: { at: string; by: string; field: string; before: unknown; after: unknown }[];
  rejected?: { at: string; by: string; reason: string };
};
export const logOf = (s: string | null | undefined): ReadingLog => { try { return s ? (JSON.parse(s) as ReadingLog) : {}; } catch { return {}; } };

const inFlight = new Set<string>();

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
      let data: Record<string, unknown>, decision;
      if (r.kind === "TIP") {
        const x = await reader.tip(photos, ctx);
        const fields = tipFields(x);
        const key = normDocket(fields.docketNo);
        const earlier = key
          ? (await prisma.receipt.findMany({ where: { kind: "TIP", id: { not: r.id }, docketNo: { not: null }, status: { not: "REJECTED" }, sentAt: { gte: new Date(Date.now() - 400 * 86_400_000) } }, select: { docketNo: true, sentBy: true, sentAt: true } }))
              .find((o) => normDocket(o.docketNo) === key)
          : undefined;
        decision = decideTip(x, { sentAt: r.sentAt, asbestosTap: r.asbestos, ourRegos: ctx.regos, duplicateOf: earlier ? `by ${earlier.sentBy} on ${earlier.sentAt.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}` : null });
        // The docket's rego, when it's one of our trucks, links it to that truck (R3; R4 uses it).
        const vehicleId = vehicleForRego(fields.rego, ctx.trucks);
        data = { ...fields, ...(vehicleId ? { vehicleId } : {}), reading: JSON.stringify({ ...prior, result: x, reasons: decision.reasons, readAt: new Date().toISOString(), tries: (prior.tries ?? 0) + 1, lastError: undefined }) };
      } else {
        const x = await reader.fuel(photos, ctx);
        const picked = ctx.trucks.find((t) => t.id === r.vehicleId)?.rego ?? null;
        decision = decideFuel(x, { sentAt: r.sentAt, ourRegos: ctx.regos, pickedRego: picked });
        data = { ...fuelFields(x), reading: JSON.stringify({ ...prior, result: x, reasons: decision.reasons, readAt: new Date().toISOString(), tries: (prior.tries ?? 0) + 1, lastError: undefined }) };
      }
      const saved = await prisma.receipt.updateMany({ where: { id: r.id, status: "SENT" }, data: { ...data, status: decision.status, checkReasons: JSON.stringify(decision.reasons) } });
      // A tip docket that now counts may be one an invoice already bills (R3).
      if (saved.count && r.kind === "TIP" && decision.status === "READ") syncTipMatchesSoon();
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
export async function readWaiting(reader: Reader = claudeReader, max = 5): Promise<number> {
  if (!readingEnabled()) return 0;
  const before = new Date(Date.now() - 60_000);
  const [receipts, odos] = await Promise.all([
    prisma.receipt.findMany({ where: { status: "SENT", sentAt: { lt: before } }, select: { id: true, reading: true }, orderBy: { sentAt: "asc" }, take: 40 }),
    prisma.odometerReading.findMany({ where: { status: "SENT", sentAt: { lt: before } }, select: { id: true, reading: true }, orderBy: { sentAt: "asc" }, take: 40 }),
  ]);
  const due = [
    ...receipts.filter((r) => (logOf(r.reading).tries ?? 0) < MAX_TRIES).map((r) => () => readReceipt(r.id, reader)),
    ...odos.filter((o) => (logOf(o.reading).tries ?? 0) < MAX_TRIES).map((o) => () => readOdometer(o.id, reader)),
  ].slice(0, max);
  for (const run of due) await run();
  return due.length;
}
