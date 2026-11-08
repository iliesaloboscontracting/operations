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
  photosPerSignIn: 20,
  photosPerDeviceDay: 60,
} as const;

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
export function validateSubmission(list: Checklist, body: unknown, open: OpenFaultRef[]): { ok: true; value: Submission } | { ok: false; error: string } {
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
    if (mediaIds.length < 1) return { ok: false, error: `Add a photo of the fault on "${item.label}".` };
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
// other open Do-not-use fault is on the machine.
export function offerBackToAvailable(
  fault: { id: string; markedDown: boolean },
  resourceStatus: string,
  faultsOnMachine: { id: string; priority: string; status: string }[],
): boolean {
  if (!fault.markedDown || resourceStatus !== "DOWN") return false;
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
