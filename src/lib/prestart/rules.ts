// Vehicle & plant pre-start checks (stage 1, Ilies approved 8 Nov 2026) - the plain rules, no database code, so the
// phone page, the office page, the routes and `npm test` (rules.test.ts) all read the same ones.
//   - a submission: every item answered OK / Fault / N/A; each Fault has a new fault (words, a priority, at least one
//     photo) or one of the machine's open faults on that item confirmed "Still there";
//   - who is alerted: Do not use and Urgent push to the Admins; Low and High are just listed;
//   - Do not use sets the machine DOWN (unless it already is);
//   - fixing a fault offers putting the machine back to Available only when this fault set it DOWN, it is still
//     DOWN, and no other open Do-not-use fault is on it.
// No money: every dollar amount is taken out of the words (lib/dailyLog/money.ts), and linkSafe stays the backstop.
import { stripMoney } from "../dailyLog/money";
import { ANSWERS, type Answer, type Checklist } from "./checklists";

export const PRIORITIES = ["DO_NOT_USE", "URGENT", "HIGH", "LOW"] as const;
export type FaultPriority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<FaultPriority, string> = { DO_NOT_USE: "Do not use", URGENT: "Urgent", HIGH: "High", LOW: "Low" };
export const PRIORITY_HINT: Record<FaultPriority, string> = {
  DO_NOT_USE: "Unsafe - park it. It's marked Down",
  URGENT: "Needs fixing today",
  HIGH: "Fix in the next day or two",
  LOW: "When it's next in the yard",
};
// The look of the site requests' priorities (lib/requestTypes.ts), plus Do not use - solid red, so it stands out.
export const PRIORITY_TONE: Record<FaultPriority, string> = {
  DO_NOT_USE: "border-red-500 bg-red-600 text-white",
  URGENT: "border-red-500/60 bg-red-500/15 text-red-300",
  HIGH: "border-amber-500/60 bg-amber-500/15 text-amber-300",
  LOW: "border-gray-600 bg-gray-700/40 text-gray-300",
};
export const PRIORITY_DOT: Record<FaultPriority, string> = { DO_NOT_USE: "⛔", URGENT: "🔴", HIGH: "🟠", LOW: "⚪" };
export const isPriority = (v: unknown): v is FaultPriority => typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
// Worst first: Do not use, Urgent, High, Low.
export const priorityRank = (p: string) => { const i = (PRIORITIES as readonly string[]).indexOf(p); return i < 0 ? PRIORITIES.length : i; };
export function worstPriority(ps: string[]): FaultPriority | null {
  const known = ps.filter(isPriority);
  return known.length ? known.reduce((a, b) => (priorityRank(b) < priorityRank(a) ? b : a)) : null;
}

export const STATUSES = ["OPEN", "IN_HAND", "FIXED"] as const;
export type FaultStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<FaultStatus, string> = { OPEN: "Open", IN_HAND: "In hand", FIXED: "Fixed" };
export const OPEN_STATUSES: FaultStatus[] = ["OPEN", "IN_HAND"];
export const isOpenStatus = (s: string) => s === "OPEN" || s === "IN_HAND";

export const LIMITS = {
  description: 500, // characters
  note: 500,
  minDescription: 3,
  minFixNote: 3,
  photosPerFault: 6,
  photosPerSignIn: 30, // stage 1b (10 Nov 2026): 5 walk-around photos + retakes + fault photos (was 20)
  photosPerDeviceDay: 60, // a hint only - the phone says which device it is (PS-001)
  // One machine, every sign-in and phone, one Sydney day (PS-001), split by kind (PS-012, 10 Nov 2026) so fault photos
  // can never use up the walk-around's allowance (or the other way round). By resource, so stage 2's plant gets them too.
  walkaroundPerMachineDay: 15, // 5 walk-around photos + retakes + an optional second set
  faultPhotosPerMachineDay: 65,
  photosAllDay: 400, // every machine, one Sydney day (PS-001)
  alertGapMinutes: 15, // at most one phone alert per machine in this long (PS-002)
  alertsPerMachineDay: 6, // and at most this many a Sydney day (Do not use ignores it - PS-011)
  queueWaiting: 50, // PS-009: more photo / check writes than this waiting -> 503 "Busy - try again"
  walkaroundMonths: 12, // walk-around photos are deleted this long after they were taken (Ilies, 10 Nov 2026)
} as const;

// PS-001 (9 Nov 2026): a photo is kept only under every cap. `counts` include the photo being added (it's recorded
// first, then counted, in one transaction - so parallel uploads can't all slip under). Plain words, 429.
// PS-012 (10 Nov 2026): the machine's day is counted for the photo's own kind - walk-around or fault.
export type PhotoRole = "FAULT" | "WALKAROUND";
export type PhotoCap = "WALKAROUND" | "FAULT" | "ALL";
export const machineCapFor = (role: PhotoRole) => (role === "WALKAROUND" ? LIMITS.walkaroundPerMachineDay : LIMITS.faultPhotosPerMachineDay);
export type PhotoCounts = { role: PhotoRole; signIn: number; roleMachineDay: number; allDay: number; deviceDay: number; sameOnSignIn: number };
export type PhotoRefusal = { error: string; status: number; capFull?: true; cap?: PhotoCap };
export const CAP_MESSAGE: Record<PhotoCap, string> = {
  WALKAROUND: "This truck's walk-around photos for today are used up - send the pre-start without them; it's noted for the office.",
  FAULT: "This truck has had all the fault photos it can take today - call the office. You can still send an Urgent or Do-not-use fault without a photo.",
  ALL: "Too many photos today - call the office. You can still send an Urgent or Do-not-use fault without a photo, and the pre-start without walk-around photos.",
};
export function photoRefusal(c: PhotoCounts): PhotoRefusal | null {
  if (c.sameOnSignIn > 1) return { error: "That photo is already added.", status: 409 };
  if (c.signIn > LIMITS.photosPerSignIn) return { error: `That's ${LIMITS.photosPerSignIn} photos for this sign-in - send the check.`, status: 429 };
  // capFull (PS-010): that allowance is used up for the day - the phone says what can still go without a photo.
  if (c.roleMachineDay > machineCapFor(c.role)) return { error: CAP_MESSAGE[c.role], status: 429, capFull: true, cap: c.role };
  if (c.allDay > LIMITS.photosAllDay) return { error: CAP_MESSAGE.ALL, status: 429, capFull: true, cap: "ALL" };
  if (c.deviceDay > LIMITS.photosPerDeviceDay) return { error: "Too many photos from this phone today - call the office.", status: 429 };
  return null;
}

// PS-009 (10 Nov 2026): the same caps read before anything is written (no transaction, no queue) - `c` is what's
// there now, so it is checked as if this photo were added. A fast 429 with nothing written; the count inside the
// transaction stays the authority.
export const photoPrecheck = (c: PhotoCounts) =>
  photoRefusal({ ...c, signIn: c.signIn + 1, roleMachineDay: c.roleMachineDay + 1, allDay: c.allDay + 1, deviceDay: c.deviceDay + 1, sameOnSignIn: c.sameOnSignIn + 1 });

// PS-010 / PS-012: is that kind's allowance for this machine (or the all-day ceiling) full? Re-counted on the server when
// the check is sent, never taken from the phone. The walk-around may be let through (LIMIT) only when the WALK-AROUND
// allowance or the ceiling is full; a fault's photo is waived only when the FAULT allowance or the ceiling is full.
export const photoCapFull = (role: PhotoRole, c: { roleMachineDay: number; allDay: number }) =>
  c.roleMachineDay >= machineCapFor(role) || c.allDay >= LIMITS.photosAllDay;
// PS-012: the caps that are full now - each one tells the Admins once a Sydney day (per machine; ALL once for everyone).
export function capsFull(c: { walkaroundMachineDay: number; faultMachineDay: number; allDay: number }): PhotoCap[] {
  const out: PhotoCap[] = [];
  if (c.walkaroundMachineDay >= LIMITS.walkaroundPerMachineDay) out.push("WALKAROUND");
  if (c.faultMachineDay >= LIMITS.faultPhotosPerMachineDay) out.push("FAULT");
  if (c.allDay >= LIMITS.photosAllDay) out.push("ALL");
  return out;
}
export function capNotice(cap: PhotoCap, machine: string): { title: string; body: string } {
  if (cap === "ALL") return { title: "Photo limit reached for all trucks today", body: "Pre-starts may go through without walk-around photos, and Urgent / Do-not-use faults without photos. Check Faults → Checks." };
  if (cap === "WALKAROUND") return { title: `Photo limit reached on ${machine} today`, body: "Its walk-around photos are used up - pre-starts may go through without photos. Check Faults → Checks." };
  return { title: `Photo limit reached on ${machine} today`, body: "Its fault photos are used up - Urgent / Do-not-use faults may go through without photos. Check Faults." };
}
// ...and then an Urgent or Do-not-use fault may go without a photo (Low / High still need one).
export const photoWaived = (priority: string, capFull: boolean) => capFull && (priority === "URGENT" || priority === "DO_NOT_USE");
export const PHOTO_LIMIT_NOTE = "Photo couldn't be added - the day's photo limit was reached.";

// PS-002 (9 Nov 2026): one phone alert per check (all its Urgent / Do-not-use faults together), and per machine at
// most one every 15 minutes and 6 a Sydney day. `sent` = this machine's alerts SENT today (and whether each had a
// Do-not-use fault). PS-011 (10 Nov 2026): an alert with a Do-not-use fault ignores the daily cap and Urgent alerts -
// it is held back only by a Do-not-use alert already SENT for the machine in the last 15 minutes.
export type AlertDecision = "SENT" | "HELD_RECENT" | "HELD_DAY";
export function alertDecision(sent: { at: Date; doNotUse: boolean }[], now: Date, doNotUse = false): AlertDecision {
  const recent = (s: { at: Date }) => now.getTime() - s.at.getTime() < LIMITS.alertGapMinutes * 60_000;
  if (doNotUse) return sent.some((s) => s.doNotUse && recent(s)) ? "HELD_RECENT" : "SENT";
  if (sent.some(recent)) return "HELD_RECENT";
  if (sent.length >= LIMITS.alertsPerMachineDay) return "HELD_DAY";
  return "SENT";
}

// ---------- walk-around photos (stage 1b, Ilies 10 Nov 2026) ----------
// Required on the FIRST truck pre-start of the Sydney day for that truck - i.e. when no pre-start today has a DONE or
// LIMIT walk-around. Later ones the same day may add them (OPTIONAL). Decided on the server, again when it's sent.
export const walkaroundRequired = (earlierToday: { walkaround: string | null }[]) =>
  !earlierToday.some((c) => c.walkaround === "DONE" || c.walkaround === "LIMIT");
// { [slot]: mediaId } as sent. Required: all five, unless the day's photo limit is full (LIMIT - let through).
export function validateWalkaround(raw: unknown, slots: readonly { key: string; label: string }[], o: { required: boolean; capFull: boolean })
  : { ok: true; photos: Record<string, string>; status: "DONE" | "LIMIT" | "OPTIONAL" | null } | { ok: false; error: string } {
  const r = raw == null ? {} : raw;
  if (typeof r !== "object" || Array.isArray(r)) return { ok: false, error: "Something's wrong with the walk-around photos - take them again." };
  const keys = new Set(slots.map((s) => s.key));
  const photos: Record<string, string> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (!keys.has(k) || !isId(v)) return { ok: false, error: "Something's wrong with the walk-around photos - take them again." };
    photos[k] = v;
  }
  if (new Set(Object.values(photos)).size !== Object.values(photos).length) return { ok: false, error: "Each walk-around photo is a different one." };
  if (!slots.length) return Object.keys(photos).length ? { ok: false, error: "No walk-around photos on this check." } : { ok: true, photos, status: null };
  if (!o.required) return { ok: true, photos, status: "OPTIONAL" };
  const missing = slots.filter((s) => !photos[s.key]);
  if (!missing.length) return { ok: true, photos, status: "DONE" };
  if (o.capFull) return { ok: true, photos, status: "LIMIT" };
  return { ok: false, error: `Take the walk-around photos first: ${missing.map((s) => s.label).join(", ")}.` };
}
// Walk-around photos are kept 12 months from when they were taken; fault photos are never removed by age.
export function walkaroundCutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - LIMITS.walkaroundMonths);
  return d;
}
export const walkaroundExpired = (m: { role: string; createdAt: Date }, now: Date) => m.role === "WALKAROUND" && m.createdAt < walkaroundCutoff(now);
// The one alert for a check: Do not use if any fault is, else Urgent; each fault on a line. Null = nothing to alert.
export function alertMessage(machine: string, by: string, faults: { itemLabel: string; priority: string; description: string; markedDown: boolean }[]) {
  const loud = faults.filter((f) => alertFor(f.priority));
  if (!loud.length) return null;
  const worst: FaultPriority = loud.some((f) => f.priority === "DO_NOT_USE") ? "DO_NOT_USE" : "URGENT";
  const lines = loud.map((f) => `${PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority} - ${f.itemLabel}: ${f.description}`.slice(0, 160));
  return {
    title: `${PRIORITY_DOT[worst]} ${PRIORITY_LABEL[worst]} - ${machine}${loud.length > 1 ? ` (${loud.length} faults)` : ""}`,
    body: `${lines.join("\n")}\n${by}${loud.some((f) => f.markedDown) ? " · marked Down on the register" : ""}`,
  };
}

// Free text from a phone or the office: one line of spaces tidied, every dollar amount taken out, cut to `max`.
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = stripMoney(v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[ \t]+/g, " ").trim()).text;
  return t.slice(0, max).trim();
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export type NewFault = { itemKey: string; itemLabel: string; description: string; priority: FaultPriority; mediaIds: string[] };
export type Submission = { answers: { key: string; label: string; answer: Answer }[]; faults: NewFault[]; stillThere: string[] };
export type OpenFaultRef = { id: string; itemKey: string | null };

const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);

// A phone's check, as sent: { answers: { [itemKey]: "OK" | "FAULT" | "NA" }, faults: [{ itemKey, description,
// priority, mediaIds }], stillThere: [faultId] }. `open` = the machine's open faults (OPEN / IN_HAND).
export function validateSubmission(list: Checklist, body: unknown, open: OpenFaultRef[], o: { capFull?: boolean } = {}): { ok: true; value: Submission } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = (b.answers && typeof b.answers === "object" && !Array.isArray(b.answers) ? b.answers : null) as Record<string, unknown> | null;
  if (!raw) return { ok: false, error: "Answer every item." };
  const keys = new Set(list.items.map((i) => i.key));
  for (const k of Object.keys(raw)) if (!keys.has(k)) return { ok: false, error: "That checklist has changed - reload the page." };
  const answers: Submission["answers"] = [];
  for (const i of list.items) {
    const a = raw[i.key];
    if (!(ANSWERS as readonly unknown[]).includes(a)) return { ok: false, error: `Answer "${i.label}".` };
    answers.push({ key: i.key, label: i.label, answer: a as Answer });
  }

  // "Still there": the machine's own open faults, each once.
  const seenRaw = b.stillThere ?? [];
  if (!Array.isArray(seenRaw) || seenRaw.length > 50 || !seenRaw.every(isId)) return { ok: false, error: "Something's wrong with the known faults - reload the page." };
  const stillThere = [...new Set(seenRaw as string[])];
  const openById = new Map(open.map((f) => [f.id, f]));
  if (stillThere.some((id) => !openById.has(id))) return { ok: false, error: "That fault has been fixed or changed - reload the page." };

  // New faults: one per item answered Fault, with words, a priority and at least one photo.
  const faultsRaw = b.faults ?? [];
  if (!Array.isArray(faultsRaw) || faultsRaw.length > list.items.length) return { ok: false, error: "Something's wrong with the faults - reload the page." };
  const faults: NewFault[] = [];
  const usedMedia = new Set<string>();
  for (const f of faultsRaw as Record<string, unknown>[]) {
    const item = list.items.find((i) => i.key === f?.itemKey);
    if (!item) return { ok: false, error: "That checklist has changed - reload the page." };
    if (raw[item.key] !== "FAULT") return { ok: false, error: `"${item.label}" isn't marked as a fault.` };
    if (faults.some((x) => x.itemKey === item.key)) return { ok: false, error: `One fault for "${item.label}" - put it all in the words.` };
    const description = cleanText(f.description, LIMITS.description);
    if (description.length < LIMITS.minDescription) return { ok: false, error: `Say what's wrong with "${item.label}".` };
    if (!isPriority(f.priority)) return { ok: false, error: `Pick how bad "${item.label}" is.` };
    const media = Array.isArray(f.mediaIds) ? f.mediaIds : [];
    if (!media.every(isId)) return { ok: false, error: "Something's wrong with a photo - take it again." };
    const mediaIds = [...new Set(media as string[])];
    if (mediaIds.length < 1 && !photoWaived(f.priority, !!o.capFull)) return { ok: false, error: `Add a photo of the fault on "${item.label}".` };
    if (mediaIds.length > LIMITS.photosPerFault) return { ok: false, error: `At most ${LIMITS.photosPerFault} photos for one fault.` };
    if (mediaIds.some((m) => usedMedia.has(m))) return { ok: false, error: "A photo can go with one fault only." };
    mediaIds.forEach((m) => usedMedia.add(m));
    faults.push({ itemKey: item.key, itemLabel: item.label, description, priority: f.priority, mediaIds });
  }

  // Every Fault answer is covered: a new fault, or a known fault on that item confirmed still there.
  for (const a of answers) {
    if (a.answer !== "FAULT") continue;
    const known = stillThere.some((id) => openById.get(id)?.itemKey === a.key);
    if (!known && !faults.some((f) => f.itemKey === a.key)) return { ok: false, error: `Tell us about the fault on "${a.label}".` };
  }
  return { ok: true, value: { answers, faults, stillThere } };
}

// Who hears about a new fault: Do not use and Urgent push to the Admins (urgent, stays until dismissed); Low and
// High send nothing - they're on the Faults page.
export function alertFor(priority: string): { urgency: "high"; sticky: true } | null {
  return priority === "DO_NOT_USE" || priority === "URGENT" ? { urgency: "high", sticky: true } : null;
}

// Do not use takes the machine off the board: DOWN on the register, unless it already is.
export const marksDown = (priority: string, resourceStatus: string) => priority === "DO_NOT_USE" && resourceStatus !== "DOWN";

// Fixing a fault: "Put it back to Available" is offered only when this fault set it DOWN, it is still DOWN, and no
// other open Do-not-use fault is on the machine. PS-008 (9 Nov 2026): and nothing has changed the machine's record since
// this fault's Down - its updatedAt is still the one that Down left - so a later, unrelated Down is never undone here.
export function offerBackToAvailable(
  fault: { id: string; markedDown: boolean; markedDownAt: Date | string | null },
  machine: { status: string; updatedAt: Date | string } | null,
  faultsOnMachine: { id: string; priority: string; status: string }[],
): boolean {
  if (!fault.markedDown || !fault.markedDownAt || !machine || machine.status !== "DOWN") return false;
  if (new Date(machine.updatedAt).getTime() !== new Date(fault.markedDownAt).getTime()) return false;
  return !faultsOnMachine.some((f) => f.id !== fault.id && f.priority === "DO_NOT_USE" && isOpenStatus(f.status));
}

// The office moves a fault on: Open -> In hand -> Fixed (or Open -> Fixed). Fixed is the end - a fault that comes back
// is a new one.
export function canMove(from: string, to: string): boolean {
  if (from === "OPEN") return to === "IN_HAND" || to === "FIXED";
  if (from === "IN_HAND") return to === "FIXED";
  return false;
}

// The office list: open ones first, then by priority (worst first), then newest first.
export function sortFaults<T extends { status: string; priority: string; reportedAt: Date | string }>(rows: T[]): T[] {
  const t = (d: Date | string) => new Date(d).getTime();
  return [...rows].sort((a, b) =>
    Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) || priorityRank(a.priority) - priorityRank(b.priority) || t(b.reportedAt) - t(a.reportedAt));
}
