// Bins (Ilies, 23 Nov 2026: "when a client asks us for a bin we deliver, take a photo of it delivered and same when its
// picked up but give the options (drop down menu) that allows them to select which job and whether it was a clients bin
// (were charging them) or it our bin for our jobs"). The plain rules - no server imports, so the link screens, the
// office page and `npm test` (bins.test.ts) read the same lists. The store is ./store.ts.
//
// - The job is always a project in Operations (no "other customer").
// - Delivered: photo (required), project, client's bin / our bin, size (then which bin when more than one is free),
//   what's going in it (the waste classes the daily log and Estimating use, or Other + a note).
// - Picked up: one of the bins on site, then a photo (required). Everything else carries over.
// - ON_SITE -> PICKED_UP; a wrong entry is CANCELLED by the office with a reason - nothing is deleted.
// - More bins of a size out than the register owns is a warning only, never a block.
// - A picked-up bin is matched to its tip docket (Receipts) only when a Manager or Admin confirms it.
// - Never a dollar figure: charging the client is done elsewhere.
import { WASTE_CLASSES } from "../activityCodes";
import { assertNoMoney } from "../moneyGuard";
import { linkLabel } from "../dailyLog/money";

// The bin sizes Lobos has (Ilies, 23 Nov 2026: 2 x 15 m³, 2 x 11 m³, 1 x 9 m³, 1 x 8 m³ and hook bin(s) - the bins
// themselves go in the register through the API; only the sizes are code).
export const BIN_SIZES = [
  { key: "M15", label: "15 m³" },
  { key: "M11", label: "11 m³" },
  { key: "M9", label: "9 m³" },
  { key: "M8", label: "8 m³" },
  { key: "HOOK", label: "Hook bin" },
] as const;
export type BinSize = (typeof BIN_SIZES)[number]["key"];
export const isBinSize = (x: unknown): x is BinSize => BIN_SIZES.some((s) => s.key === x);
export const sizeLabel = (k: string) => BIN_SIZES.find((s) => s.key === k)?.label ?? k;

// Client's bin: the client asked for it and is charged for it (a variation - Alex tracks these). Our bin: for our job.
export const BIN_USES = [
  { key: "CLIENT", label: "Client's bin", hint: "the client asked for it - we're charging them" },
  { key: "OURS", label: "Our bin", hint: "for our job" },
] as const;
export type BinUse = (typeof BIN_USES)[number]["key"];
export const useLabel = (k: string) => BIN_USES.find((u) => u.key === k)?.label ?? k;

// What's going in it: the waste classes already used by the daily log's dockets and Estimating (lib/activityCodes.ts),
// plus Other with a typed note.
export const OTHER = "OTHER";
export const BIN_CONTENTS: readonly { key: string; label: string }[] = [...WASTE_CLASSES.map((w) => ({ key: w, label: w })), { key: OTHER, label: "Other" }];
export const contentsLabel = (k: string, note?: string | null) => (k === OTHER ? (note ? `Other - ${note}` : "Other") : k);

export const STATUSES = ["ON_SITE", "PICKED_UP", "CANCELLED"] as const;
export type BinStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<BinStatus, string> = { ON_SITE: "On site", PICKED_UP: "Picked up", CANCELLED: "Cancelled" };
// The moves a movement can make: the link picks a bin up; the office cancels a wrong entry or puts a wrong pick-up
// back on site (with a reason). A cancelled entry stays cancelled.
const MOVES: Record<BinStatus, readonly BinStatus[]> = { ON_SITE: ["PICKED_UP", "CANCELLED"], PICKED_UP: ["ON_SITE", "CANCELLED"], CANCELLED: [] };
export const canMove = (from: string, to: string) => (MOVES[from as BinStatus] ?? []).includes(to as BinStatus);

export const LIMITS = { photosPerMove: 2, photosPerLinkPerDay: 40, movesPerLinkPerDay: 40 };

const ID = /^[a-z0-9]{20,40}$/;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))] : []);
// Free text from a phone or the office: one line, at most `max`, no dollar figure (refused, as the reimbursement note is).
export const tidy = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export type DeliveryInput = { projectId: string; use: BinUse; size: BinSize; binId: string | null; contents: string; contentsNote: string | null; photoIds: string[] };

// A delivery from a phone. Whether the project, the bin and the photos are real (and ones this link may use) is the
// store's job.
export function parseDelivery(b: Record<string, unknown>): DeliveryInput | { error: string } {
  const photoIds = ids(b.photoIds);
  if (photoIds.length === 0) return { error: "Take a photo of the bin first." };
  if (photoIds.length > LIMITS.photosPerMove) return { error: `At most ${LIMITS.photosPerMove} photos.` };
  const projectId = id(b.projectId);
  if (!projectId) return { error: "Which job is it for?" };
  const use = BIN_USES.find((u) => u.key === b.use)?.key;
  if (!use) return { error: "Client's bin or our bin?" };
  if (!isBinSize(b.size)) return { error: "What size is the bin?" };
  const contents = BIN_CONTENTS.find((c) => c.key === b.contents)?.key;
  if (!contents) return { error: "What's going in it?" };
  const note = tidy(b.contentsNote, 120);
  if (note && !assertNoMoney(note)) return { error: "Leave amounts off - just say what's going in it." };
  if (contents === OTHER && note.length < 2) return { error: "Say what's going in it." };
  return { projectId, use, size: b.size, binId: id(b.binId), contents, contentsNote: note || null, photoIds };
}

export type PickupInput = { movementId: string; photoIds: string[] };
export function parsePickup(b: Record<string, unknown>): PickupInput | { error: string } {
  const movementId = id(b.movementId);
  if (!movementId) return { error: "Which bin are you picking up?" };
  const photoIds = ids(b.photoIds);
  if (photoIds.length === 0) return { error: "Take a photo of the bin first." };
  if (photoIds.length > LIMITS.photosPerMove) return { error: `At most ${LIMITS.photosPerMove} photos.` };
  return { movementId, photoIds };
}

// Which bin a delivery is: the one picked; the only free one of that size; or none (size only - the bin isn't in the
// register yet, or every bin of that size is already out: allowed, and shown as a warning). Two or more free and
// none picked -> ask which.
export function chooseBin(input: { size: string; binId: string | null }, free: { id: string; size: string }[]): { binId: string | null } | { error: string } {
  const ofSize = free.filter((b) => b.size === input.size);
  if (input.binId) return ofSize.some((b) => b.id === input.binId) ? { binId: input.binId } : { error: "That bin isn't free - pick it again." };
  if (ofSize.length > 1) return { error: "Which bin is it?" };
  return { binId: ofSize[0]?.id ?? null };
}

// More bins of a size out than the register owns - information only (Ilies: never a block).
export type FleetWarning = { size: string; label: string; out: number; owned: number; text: string };
export function overFleet(out: { size: string }[], owned: { size: string }[]): FleetWarning[] {
  return BIN_SIZES.flatMap(({ key, label }) => {
    const o = out.filter((x) => x.size === key).length;
    const n = owned.filter((x) => x.size === key).length;
    return o > n ? [{ size: key, label, out: o, owned: n, text: `${o} × ${label} out, but the register has ${n} - check the register or the entries.` }] : [];
  });
}

// A label for a bin in the register: 1-40 characters, no amount.
export function binLabel(v: unknown): string | { error: string } {
  const s = tidy(v, 41);
  if (s.length < 1) return { error: "Give the bin a name, e.g. \"15 m³ (1)\"." };
  if (s.length > 40) return { error: "At most 40 characters." };
  if (!assertNoMoney(s)) return { error: "Names only - no amounts." };
  return s;
}
// The next free default label for a size: "15 m³ (3)".
export function defaultLabel(size: string, existing: string[]): string {
  const base = sizeLabel(size);
  let n = existing.length + 1;
  while (existing.some((l) => l.toLowerCase() === `${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

// A correction from the office (Manager+): the fields to change and the reason (required). Status changes are their
// own actions (cancel / put back on site).
export type CorrectionInput = { fields: Partial<{ projectId: string; use: BinUse; size: BinSize; binId: string | null; contents: string; contentsNote: string | null }>; reason: string };
export function parseCorrection(b: Record<string, unknown>): CorrectionInput | { error: string } {
  const reason = tidy(b.reason, 300);
  if (reason.length < 3) return { error: "Say why it's being corrected." };
  const fields: CorrectionInput["fields"] = {};
  if (b.projectId !== undefined) { const p = id(b.projectId); if (!p) return { error: "Pick the job." }; fields.projectId = p; }
  if (b.use !== undefined) { const u = BIN_USES.find((x) => x.key === b.use)?.key; if (!u) return { error: "Client's bin or our bin?" }; fields.use = u; }
  if (b.size !== undefined) { if (!isBinSize(b.size)) return { error: "Pick a size." }; fields.size = b.size; }
  if (b.binId !== undefined) { const v = b.binId === null || b.binId === "" ? null : id(b.binId); if (v === null && b.binId) return { error: "Pick a bin." }; fields.binId = v; }
  if (b.contents !== undefined) { const c = BIN_CONTENTS.find((x) => x.key === b.contents)?.key; if (!c) return { error: "What's in it?" }; fields.contents = c; }
  if (b.contentsNote !== undefined) {
    const n = tidy(b.contentsNote, 120);
    if (n && !assertNoMoney(n)) return { error: "No amounts in the note." };
    fields.contentsNote = n || null;
  }
  if (Object.keys(fields).length === 0) return { error: "Nothing to change." };
  if (!assertNoMoney(reason)) return { error: "Leave amounts out of the reason." };
  return { fields, reason };
}

// ---------- client's bins: charged per bin (Ilies, 23 Nov 2026: "price per bin not days bins onsite") ----------

// How many client's bins each job had delivered: of which on site now and picked up. Our bins and cancelled entries
// don't count. No days figure - days out is information on the Out now list only, never what's charged.
export type ClientBinCount = { delivered: number; onSite: number; pickedUp: number };
export function clientBinCounts(rows: { projectId: string; use: string; status: string }[]): Map<string, ClientBinCount> {
  const out = new Map<string, ClientBinCount>();
  for (const r of rows) {
    if (r.use !== "CLIENT" || r.status === "CANCELLED") continue;
    const c = out.get(r.projectId) ?? { delivered: 0, onSite: 0, pickedUp: 0 };
    c.delivered++;
    if (r.status === "ON_SITE") c.onSite++; else if (r.status === "PICKED_UP") c.pickedUp++;
    out.set(r.projectId, c);
  }
  return out;
}

// ---------- the phone alert to Alex when a client's bin is delivered (Ilies, 23 Nov 2026: "Yes, alert Alex") ----------

// Kill switch: BIN_ALERTS=off.
export const binAlertsOn = (env: Record<string, string | undefined> = process.env) => (env.BIN_ALERTS ?? "").trim().toLowerCase() !== "off";
export type BinAlert = { title: string; body: string; url: string; tag: string; silent: boolean };
// One quiet alert per client's bin delivered: words only - the job and the size. Our bin: nothing. Anything that
// would carry a dollar figure is never sent (the job name has any "$" amount taken out first).
export function clientBinAlert(m: { id: string; use: string; size: string; project: string }): BinAlert | null {
  if (m.use !== "CLIENT") return null;
  const msg = { title: "Client's bin delivered", body: `${linkLabel(m.project, "a job")}, ${sizeLabel(m.size)}`, url: "/bins", tag: `bin-${m.id}`.slice(0, 40), silent: true };
  return assertNoMoney(JSON.stringify(msg)) ? msg : null;
}

// ---------- the tip docket for a picked-up bin ----------

// A suggestion only: a tip docket (TIP receipt, not set aside) on the same project, dated (the docket's own date, else
// when it was sent) from a little before the pick-up (the pick-up may be tapped after tipping) to about 2 days after;
// not already confirmed for another bin and not one a person said isn't this bin's. The same link or person (the
// driver who picked it up) first, then the nearest in time. A Manager or Admin confirms - never automatic.
export const TIP_WINDOW = { beforeMs: 6 * 3_600_000, afterMs: 48 * 3_600_000 };
// What a Manager+ may confirm: the same project, from a day before the pick-up to two weeks after.
export const CONFIRM_WINDOW = { beforeMs: 24 * 3_600_000, afterMs: 14 * 86_400_000 };
export type TipReceipt = {
  id: string; kind: string; status: string; projectId: string | null; siteLinkId: string; sentByResourceId: string | null;
  sentAt: Date; docketAt: Date | null;
};
export type PickedUp = { id: string; projectId: string; pickedUpAt: Date | null; pickedUpLinkId: string | null; pickedUpByResourceId: string | null; tipRejectedIds?: string | null };
export const receiptAt = (r: Pick<TipReceipt, "sentAt" | "docketAt">) => r.docketAt ?? r.sentAt;
export const rejectedOf = (s: string | null | undefined): string[] => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

export function inWindow(m: PickedUp, r: Pick<TipReceipt, "sentAt" | "docketAt">, w: { beforeMs: number; afterMs: number }) {
  if (!m.pickedUpAt) return false;
  const t = receiptAt(r).getTime(), p = m.pickedUpAt.getTime();
  return t >= p - w.beforeMs && t <= p + w.afterMs;
}
export function tipEligible(m: PickedUp, r: TipReceipt, w = TIP_WINDOW) {
  return r.kind === "TIP" && r.status !== "REJECTED" && !!r.projectId && r.projectId === m.projectId && inWindow(m, r, w);
}
export function tipCandidates<T extends TipReceipt>(m: PickedUp, receipts: T[], takenElsewhere: Set<string>, max = 5): (T & { sameDriver: boolean })[] {
  if (!m.pickedUpAt) return [];
  const rejected = new Set(rejectedOf(m.tipRejectedIds));
  const p = m.pickedUpAt.getTime();
  return receipts
    .filter((r) => tipEligible(m, r) && !rejected.has(r.id) && !takenElsewhere.has(r.id))
    .map((r) => ({ ...r, sameDriver: (!!m.pickedUpLinkId && r.siteLinkId === m.pickedUpLinkId) || (!!m.pickedUpByResourceId && r.sentByResourceId === m.pickedUpByResourceId) }))
    .sort((a, b) => Number(b.sameDriver) - Number(a.sameDriver) || Math.abs(receiptAt(a).getTime() - p) - Math.abs(receiptAt(b).getTime() - p))
    .slice(0, max);
}

// ---------- days out and dates (Sydney) ----------

export const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
// Whole Sydney calendar days from delivery to pick-up (or now): delivered today = 0.
export function daysOut(from: Date, to: Date): number {
  const a = Date.parse(`${sydneyDay(from)}T00:00:00Z`), b = Date.parse(`${sydneyDay(to)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
export const daysText = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`);
export const dayText = (d: Date) => d.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

// ---------- what a link gets back ----------

// One bin on site (or one this person moved today) on the phone: words and dates only - no price, no person.
export type BinLinkRowDTO = { id: string; projectId: string; project: string; bin: string; size: string; use: string; contents: string; delivered: string; days: string; status: string };
export type BinLinkOptionsDTO = {
  projects: { id: string; label: string; mine: boolean }[];
  uses: { key: string; label: string; hint: string }[];
  sizes: { key: string; label: string; free: { id: string; label: string }[] }[];
  contents: { key: string; label: string }[];
  onSite: BinLinkRowDTO[];
  today: BinLinkRowDTO[];
};
// The money guard for everything a link gets back - no dollar figure anywhere in it.
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x));
