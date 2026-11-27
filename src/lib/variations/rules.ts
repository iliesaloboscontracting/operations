// Variation / Day docket (Ilies approved 25 Nov 2026: "yes build it, deploy once it passes") - his paper "Variation /
// Day Docket" made digital. The plain rules: no server imports, so the phone screen, the office pages, the store and
// `npm test` (variations.test.ts) all read the same lists and the same hours maths.
//
// - Who fills it: a SUPERVISOR link, or a HANDOVER link on the job it covers that day. Never a DRIVER, POSTER or
//   OFFICE link, and never the YARD login.
// - The client signs with a finger on the supervisor's phone (name + position typed), then the supervisor signs. Send
//   stays off until the client has signed. No email goes anywhere - the office prints or downloads it themselves.
// - The docket number (V-0001 ...) is given on Send. A sent docket is never changed: a correction is a new docket that
//   says which one it replaces.
// - No price, rate or amount anywhere: a "$" or an amount in any box is refused (the office prices variations).
// - Hours are a record only - never sign-ins, timesheets, JobActual, allocations or costs.
import { assertNoMoney } from "../moneyGuard";
import { linkLabel, stripMoney } from "../dailyLog/money";
import { WASTE_CLASSES } from "../activityCodes";

// Kill switch: VARIATION_DOCKETS=off turns off the link side (the tile, the link routes and their photo uploads - 503)
// and the phone alerts. The office still reads, prints and prices the dockets already sent (/variations and
// /api/variations/* keep working) - VD-003, Ilies approved 25 Nov 2026.
export const variationsOn = (env: Record<string, string | undefined> = process.env) => (env.VARIATION_DOCKETS ?? "").trim().toLowerCase() !== "off";
export const OFF_MESSAGE = "Variation dockets are switched off right now - use a paper docket and tell the office.";

// "Please tick below" - the paper's boxes, in its order.
export const TICKS = [
  { key: "VARIATION", label: "Variation / extra work" },
  { key: "LABOUR_HIRE", label: "Labour hire" },
  { key: "MATERIALS", label: "Materials used" },
  { key: "RUBBISH", label: "Rubbish removal" },
  { key: "TOOL_HIRE", label: "Tool hire" },
  { key: "OTHER", label: "Other" },
] as const;
export type Tick = (typeof TICKS)[number]["key"];
export const tickLabel = (k: string) => TICKS.find((t) => t.key === k)?.label ?? k;

// The units an equipment / tool / materials / waste row can be in.
export const UNITS = [
  { key: "M3", label: "m³" },
  { key: "EACH", label: "each" },
  { key: "HRS", label: "hrs" },
  { key: "OTHER", label: "other" },
] as const;
export type Unit = (typeof UNITS)[number]["key"] | typeof LOADS;

// Loads (Ilies, 28 Nov 2026: "lets actually change the quanitity estimated to just loads.. eg: how many loads 1, what
// is the material type: mixed waste" - and "dont delete the current code. just switcht the current set up off. i think
// in the future we may go back to that when the pricing is right"). Each row is now "How many loads" + "Material type"
// (unit LOADS). The old quantity + unit rows (m³ / each / hrs / other) are still here, switched off:
// VARIATION_ITEMS=detailed in .env brings them back on the phone (and the server accepts them again). Dockets already
// sent keep whatever they were sent with, and show it.
export const LOADS = "LOADS";
export type ItemMode = "LOADS" | "DETAILED";
export const variationItemMode = (env: Record<string, string | undefined> = process.env): ItemMode =>
  (env.VARIATION_ITEMS ?? "").trim().toLowerCase() === "detailed" ? "DETAILED" : "LOADS";
// Suggestions only - the supervisor can type any material.
export const MATERIAL_SUGGESTIONS: readonly string[] = ["Mixed waste", ...WASTE_CLASSES];
export const unitLabel = (k: string, q?: number | null) => (k === LOADS ? (q === 1 ? "load" : "loads") : UNITS.find((u) => u.key === k)?.label ?? k);
// "1 load", "3 loads", "2.5 m³" - one place for the phone and the office.
export const itemQty = (quantity: number | null, unit: string) => (quantity != null ? `${quantity} ${unitLabel(unit, quantity)}` : "");

export const LIMITS = {
  tasks: 20, items: 30, photos: 10,
  description: 500, type: 80, comment: 200, name: 80, position: 60, otherText: 80, note: 1000,
  men: 50, quantity: 100_000, loads: 500,
  signatureBytes: 200 * 1024, // a finger signature PNG is a few KB; 200 KB is plenty
  signatureSide: 4000, // px, either way
  perLinkDay: 30, // dockets one link can send in a Sydney day
  sentDays: 7, // the link shows its own dockets from today and the last 7 days
} as const;

// The Lobos footer on the paper docket.
export const LOBOS = { name: "Lobos Contracting Pty Ltd", abn: "75 639 831 280", address: "7 Argyle Street Wolli Creek NSW 2205" } as const;

// ---------- the docket number ----------

export const docketNo = (n: number) => `V-${String(n).padStart(4, "0")}`;
// "V-0012", "v12", "12" -> 12; anything else null.
export function parseDocketNo(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e7) return v;
  if (typeof v !== "string") return null;
  const m = /^\s*(?:v\s*-?\s*)?0*(\d{1,7})\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

// The next number: one more than the highest so far, and the unique index on the number decides - if another phone got
// there first (the create fails as a duplicate), look again and try the next one. `create` makes the whole docket (and
// its rows) in one go, so a failed try leaves nothing behind.
export const isUniqueClash = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";
export async function allocateNumber<T>(highest: () => Promise<number>, create: (n: number) => Promise<T>, tries = 12): Promise<{ number: number; row: T }> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    const n = (await highest()) + 1;
    try {
      return { number: n, row: await create(n) };
    } catch (e) {
      if (!isUniqueClash(e)) throw e;
      last = e;
    }
  }
  throw last ?? new Error("no docket number");
}

// ---------- hours (plain code - the phone shows it, the server works it out again) ----------

// "07:30" -> 450 minutes after midnight; anything else null.
export function clockMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const r2 = (n: number) => Math.round(n * 100) / 100;
// Start to finish in hours. A finish before the start runs past midnight (a night shift). The same time twice = null.
export function spanHours(start: unknown, finish: unknown): number | null {
  const a = clockMinutes(start), b = clockMinutes(finish);
  if (a === null || b === null || a === b) return null;
  return r2(((b - a + 1440) % 1440) / 60);
}
// Total hours spent on a task: the time from start to finish x the number of men (1 when not given) - man-hours, as
// the paper's "Total hrs spent" adds up the crew. null when the times aren't both there.
export function taskHours(t: { men?: number | null; start?: unknown; finish?: unknown }): number | null {
  const span = spanHours(t.start, t.finish);
  if (span === null) return null;
  const men = typeof t.men === "number" && Number.isInteger(t.men) && t.men > 0 ? t.men : 1;
  return r2(span * men);
}
export const totalHours = (tasks: { hours: number | null }[]) => r2(tasks.reduce((a, t) => a + (t.hours ?? 0), 0));
export const hoursText = (n: number | null | undefined) => (n == null ? "" : `${r2(n)} h`);

// ---------- text ----------

// Any amount at all: a "$" (any dollar sign) or a money pattern ("500 dollars", "2.5k quote", "AUD 80").
const DOLLAR = /[$＄﹩]/;
export const hasMoney = (s: string) => DOLLAR.test(s) || stripMoney(s).removed || !assertNoMoney(s);
export const MONEY_REFUSED = "Leave prices and amounts off - the office prices variations. Say what was done, not what it costs.";
// One line: control characters out, spaces tidied, at most `max`.
export const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
// Several lines (a description, a note): line breaks kept (at most 2 in a row), other control characters out.
export const lines = (v: unknown, max: number) =>
  typeof v === "string"
    ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\p{Cf}]/gu, " ").replace(/[^\S\n]+/g, " ").split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
    : "";

// ---------- what the phone sends ----------

export type TaskInput = { n: number; description: string; men: number | null; start: string | null; finish: string | null; hours: number | null; hoursCalc: number | null };
export type ItemInput = { n: number; quantity: number | null; unit: Unit; type: string; comment: string | null };
export type DocketInput = {
  jobId: string; ticks: Tick[]; otherText: string | null; tasks: TaskInput[]; items: ItemInput[]; note: string | null; photoIds: string[];
  customerName: string; customerPosition: string | null; lobosPosition: string | null; replaces: number | null;
  customerSignature: string; lobosSignature: string; // data URLs - checked by ./signature.ts
};
const ID = /^[a-z0-9]{10,40}$/;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const dataUrl = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/png;base64,") ? v : "");
type Err = { error: string };

// The whole docket from the phone, checked: lengths, times, row counts, no amounts anywhere. Whether the job, the
// photos and the docket it replaces are real (and this link's) is the store's job; the signatures' bytes ./signature.ts.
export function parseDocket(b: Record<string, unknown>, mode: ItemMode = variationItemMode()): DocketInput | Err {
  const jobId = typeof b.jobId === "string" && ID.test(b.jobId) ? b.jobId : null;
  if (!jobId) return { error: "Which job is it for?" };
  const rawTicks = Array.isArray(b.ticks) ? b.ticks : [];
  const ticks = TICKS.map((t) => t.key).filter((k) => rawTicks.includes(k)) as Tick[];
  if (rawTicks.some((t) => !TICKS.some((x) => x.key === t))) return { error: "Tick from the list." };
  if (!ticks.length) return { error: "Tick what the docket is for." };
  const otherText = line(b.otherText, LIMITS.otherText + 1);
  if (otherText.length > LIMITS.otherText) return { error: `"Other" - at most ${LIMITS.otherText} characters.` };
  if (ticks.includes("OTHER") && otherText.length < 2) return { error: "Say what \"Other\" is." };

  const rawTasks = Array.isArray(b.tasks) ? b.tasks : [];
  if (rawTasks.length > LIMITS.tasks) return { error: `At most ${LIMITS.tasks} task rows.` };
  const tasks: TaskInput[] = [];
  for (const [i, x] of rawTasks.entries()) {
    const t = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const row = `Task ${i + 1}`;
    const description = lines(t.description, LIMITS.description + 1);
    if (description.length < 2) return { error: `${row}: describe the work.` };
    if (description.length > LIMITS.description) return { error: `${row}: at most ${LIMITS.description} characters.` };
    const menN = num(t.men);
    if (menN !== null && (!Number.isInteger(menN) || menN < 1 || menN > LIMITS.men)) return { error: `${row}: men 1 to ${LIMITS.men}.` };
    const start = t.start == null || t.start === "" ? null : typeof t.start === "string" && clockMinutes(t.start) !== null ? t.start.trim().padStart(5, "0") : undefined;
    const finish = t.finish == null || t.finish === "" ? null : typeof t.finish === "string" && clockMinutes(t.finish) !== null ? t.finish.trim().padStart(5, "0") : undefined;
    if (start === undefined || finish === undefined) return { error: `${row}: a time like 07:30.` };
    if ((start === null) !== (finish === null)) return { error: `${row}: put both the start and the finish (or neither).` };
    if (start !== null && start === finish) return { error: `${row}: the finish can't be the same as the start.` };
    const hoursCalc = taskHours({ men: menN, start, finish });
    const given = num(t.hours);
    const maxHours = 24 * (menN ?? 1);
    if (given !== null && (given <= 0 || given > maxHours)) return { error: `${row}: total hours between 0 and ${maxHours}.` };
    tasks.push({ n: i + 1, description, men: menN, start, finish, hours: given !== null ? r2(given) : hoursCalc, hoursCalc });
  }

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length > LIMITS.items) return { error: mode === "LOADS" ? `At most ${LIMITS.items} load rows.` : `At most ${LIMITS.items} equipment / materials rows.` };
  const items: ItemInput[] = [];
  for (const [i, x] of rawItems.entries()) {
    const t = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    if (mode === "LOADS") {
      const row = `Load row ${i + 1}`;
      const type = line(t.type, LIMITS.type + 1);
      if (type.length < 1) return { error: `${row}: say what the material is (e.g. mixed waste).` };
      if (type.length > LIMITS.type) return { error: `${row}: the material at most ${LIMITS.type} characters.` };
      const q = num(t.quantity);
      if (q === null || !Number.isInteger(q) || q < 1 || q > LIMITS.loads) return { error: `${row}: how many loads - a whole number from 1 to ${LIMITS.loads}.` };
      const comment = line(t.comment, LIMITS.comment + 1);
      if (comment.length > LIMITS.comment) return { error: `${row}: comments at most ${LIMITS.comment} characters.` };
      items.push({ n: i + 1, quantity: q, unit: LOADS, type, comment: comment || null });
      continue;
    }
    const row = `Equipment / materials row ${i + 1}`;
    const type = line(t.type, LIMITS.type + 1);
    if (type.length < 1) return { error: `${row}: say what it is.` };
    if (type.length > LIMITS.type) return { error: `${row}: at most ${LIMITS.type} characters.` };
    const q = num(t.quantity);
    if (t.quantity != null && t.quantity !== "" && q === null) return { error: `${row}: the quantity is a number.` };
    if (q !== null && (q < 0 || q > LIMITS.quantity)) return { error: `${row}: a quantity from 0 to ${LIMITS.quantity}.` };
    const unit = UNITS.find((u) => u.key === (t.unit ?? "EACH"))?.key;
    if (!unit) return { error: `${row}: m³, each, hrs or other.` };
    const comment = line(t.comment, LIMITS.comment + 1);
    if (comment.length > LIMITS.comment) return { error: `${row}: comments at most ${LIMITS.comment} characters.` };
    items.push({ n: i + 1, quantity: q === null ? null : r2(q), unit, type, comment: comment || null });
  }
  if (!tasks.length && !items.length) return { error: mode === "LOADS" ? "Add a task, or the loads taken away." : "Add a task, or the equipment / materials used." };

  const note = lines(b.note, LIMITS.note + 1);
  if (note.length > LIMITS.note) return { error: `The note - at most ${LIMITS.note} characters.` };
  const rawPhotos = Array.isArray(b.photoIds) ? b.photoIds : [];
  if (rawPhotos.some((p) => typeof p !== "string" || !ID.test(p))) return { error: "A photo couldn't be found - add it again." };
  const photoIds = [...new Set(rawPhotos as string[])];
  if (photoIds.length > LIMITS.photos) return { error: `At most ${LIMITS.photos} photos.` };

  const customerName = line(b.customerName, LIMITS.name + 1);
  if (customerName.length < 2) return { error: "The client's name." };
  if (customerName.length > LIMITS.name) return { error: `The client's name - at most ${LIMITS.name} characters.` };
  const customerPosition = line(b.customerPosition, LIMITS.position + 1);
  const lobosPosition = line(b.lobosPosition, LIMITS.position + 1);
  if (customerPosition.length > LIMITS.position || lobosPosition.length > LIMITS.position) return { error: `Position - at most ${LIMITS.position} characters.` };
  const customerSignature = dataUrl(b.customerSignature);
  if (!customerSignature) return { error: "The client needs to sign first." };
  const lobosSignature = dataUrl(b.lobosSignature);
  if (!lobosSignature) return { error: "Sign it yourself too (Lobos sign-off)." };
  const replaces = b.replaces == null || b.replaces === "" ? null : parseDocketNo(b.replaces);
  if (b.replaces != null && b.replaces !== "" && replaces === null) return { error: "Which docket does it replace? e.g. V-0012" };

  // No amount anywhere a person typed.
  const typed = [otherText, note, customerName, customerPosition, lobosPosition, ...tasks.map((t) => t.description), ...items.flatMap((x) => [x.type, x.comment ?? ""])];
  if (typed.some(hasMoney)) return { error: MONEY_REFUSED };

  return {
    jobId, ticks, otherText: ticks.includes("OTHER") ? otherText : null, tasks, items, note: note || null, photoIds,
    customerName, customerPosition: customerPosition || null, lobosPosition: lobosPosition || null, replaces, customerSignature, lobosSignature,
  };
}

// VD-001 (Ilies approved 25 Nov 2026): a correction may replace only a docket the same person sent, on the same project
// (or the same board job when there's no project). -> the refusal, or null when it may.
export function replaceRefusal(
  replaced: { number: number; jobId: string; projectId: string | null; resourceId: string | null } | null,
  job: { id: string; projectId: string | null },
  personId: string | null,
  asked: number,
): string | null {
  const same = replaced && (job.projectId ? replaced.projectId === job.projectId : replaced.jobId === job.id);
  if (!replaced || !same) return `${docketNo(asked)} isn't a docket on this job.`;
  if (!personId || replaced.resourceId !== personId) return `You can only correct a docket you sent. Ask the supervisor who sent ${docketNo(replaced.number)}, or the office.`;
  return null;
}

// VD-002 (Ilies approved 25 Nov 2026): the Building Agent login (Operations AI) may look at the list and a docket, but
// never changes a status and never sees a signature or a photo. (The email is lib/session.ts BUILDING_AGENT_EMAIL.)
export const isAgentEmail = (email: string | null | undefined, agentEmail: string) => (email ?? "").trim().toLowerCase() === agentEmail.toLowerCase();
export const AGENT_NO_STATUS = "The Building Agent login can't change a docket's status.";
export const AGENT_NO_FILES = "The Building Agent login can't open signatures or photos.";

// ---------- the office's status (kept apart from the signed docket) ----------

export const STATUSES = ["TO_PRICE", "PRICED", "SENT_TO_CLIENT"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { TO_PRICE: "To price", PRICED: "Priced", SENT_TO_CLIENT: "Sent to client" };
export const isStatus = (x: unknown): x is Status => (STATUSES as readonly unknown[]).includes(x);
// The current status: the newest event's, or To price when there is none.
// The same rule the office's status filter uses in SQL (store.ts statusIs): newest by time, then by id.
export const currentStatus = (events: { id?: string; status: string; createdAt: Date }[]): Status => {
  const last = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || ((b.id ?? "") > (a.id ?? "") ? 1 : (b.id ?? "") < (a.id ?? "") ? -1 : 0))[0];
  return last && isStatus(last.status) ? last.status : "TO_PRICE";
};
// A change: to another status; forward (To price -> Priced -> Sent to client) any time, back a step only with a note
// saying why. The phone that saw `from` must still be right (two people at once - the second gets told).
export function statusChange(current: Status, b: Record<string, unknown>): { to: Status; note: string | null } | Err {
  if (!isStatus(b.status)) return { error: "To price, Priced or Sent to client?" };
  if (b.from !== undefined && b.from !== current) return { error: `Someone changed it to "${STATUS_LABEL[current]}" - have a look and try again.` };
  if (b.status === current) return { error: `It's already "${STATUS_LABEL[current]}".` };
  const note = line(b.note, 301);
  if (note.length > 300) return { error: "The note - at most 300 characters." };
  if (hasMoney(note)) return { error: "No amounts in the note - prices go in the quote, not here." };
  const back = STATUSES.indexOf(b.status) < STATUSES.indexOf(current);
  if (back && note.length < 3) return { error: "Say why it's going back a step." };
  return { to: b.status, note: note || null };
}

// ---------- who sees it ----------

// The office page (/variations) and its data: Managers, Admins (the owner is one) and the coordinator - exactly. Never
// VIEWER, ACCOUNTS, TIMESHEETS, YARD or DIRECTOR. (No role ladder here - only the four by name.)
export const VARIATION_OFFICE_ROLES: readonly string[] = ["ADMIN", "MANAGER", "COORDINATOR"];
export const mayReadVariations = (role: string) => VARIATION_OFFICE_ROLES.includes(role);
// The links that fill one in: a person's SUPERVISOR link, or a HANDOVER link (on its own job only - the store's job
// list). Never OFFICE (or the yard's shared link), DRIVER or POSTER.
export const linkMayFill = (link: { kind: string; shared?: boolean; person?: { id: string | null } }) =>
  (link.kind === "SUPERVISOR" || link.kind === "HANDOVER") && !link.shared && !!link.person?.id;

// ---------- the phone alert ----------

export type VariationAlert = { title: string; body: string; url: string; tag: string };
// "Variation V-0012 signed - <project> (<supervisor>)", opening /variations/<id>. Words only: the project's name with
// any amount taken out first, and never sent if a dollar figure would still be in it.
export function signedAlert(d: { id: string; number: number; projectName: string; supervisor: string }): VariationAlert | null {
  const msg = {
    title: "Variation docket signed",
    body: `Variation ${docketNo(d.number)} signed - ${linkLabel(d.projectName, "a job")} (${linkLabel(d.supervisor, "the supervisor")})`.slice(0, 160),
    url: `/variations/${d.id}`,
    tag: `variation-${d.id}`.slice(0, 40),
  };
  return assertNoMoney(JSON.stringify(msg)) && !DOLLAR.test(msg.body) ? msg : null;
}
// Who gets it: every active COORDINATOR login (Alex) and the owner (Ilies) - nobody else.
export function alertRecipients(users: { id: string; role: string; email: string; active: boolean }[], ownerEmail: string): string[] {
  return users.filter((u) => u.active && (u.role === "COORDINATOR" || u.email.toLowerCase() === ownerEmail.toLowerCase())).map((u) => u.id);
}

// ---------- what a link gets back ----------

export type LinkJobDTO = { id: string; label: string; day: string; night: boolean; projectName: string; jobNo: string | null; address: string | null; client: string | null };
export type LinkDocketDTO = {
  id: string; number: string; day: string; project: string; sentAt: string; ticks: string[]; customerName: string; replaces: string | null;
  tasks: { n: number; description: string; men: number | null; start: string | null; finish: string | null; hours: number | null }[];
  items: { n: number; quantity: number | null; unit: string; type: string; comment: string | null }[];
  photos: number;
};
export type LinkViewDTO = {
  on: boolean; jobs: LinkJobDTO[]; lobosName: string; sent: LinkDocketDTO[]; sentToday: number; perDay: number;
  media: { on: true; kinds: readonly string[]; photoMaxBytes: number } | { on: false };
  limits: { tasks: number; items: number; photos: number };
  itemMode: ItemMode; // LOADS = "How many loads" + "Material type" (28 Nov 2026); DETAILED = the old quantity + unit rows
};
// The money guard for everything a link gets back - no dollar figure anywhere in it.
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x));

// ---------- the office's view ----------

export type OfficeRowDTO = {
  id: string; number: string; day: string; projectId: string; project: string; jobNo: string | null; client: string | null;
  ticks: string[]; supervisor: string; customerName: string; sentAt: string; status: Status; statusLabel: string;
  replaces: string | null; replacedBy: string | null; tasks: number; items: number; photos: number; hours: number;
};
export type OfficeDetailDTO = OfficeRowDTO & {
  jobId: string; address: string | null; otherText: string | null; note: string | null; customerPosition: string | null;
  lobosName: string; lobosPosition: string | null; signedAt: string; linkKind: string; replacesId: string | null;
  corrections: { id: string; number: string }[]; // every docket that replaces this one, oldest first (VD-001)
  taskRows: { n: number; description: string; men: number | null; start: string | null; finish: string | null; hours: number | null; hoursCalc: number | null; edited: boolean }[];
  itemRows: { n: number; quantity: number | null; unit: string; type: string; comment: string | null }[];
  photoIds: string[];
  signatures: { customer: boolean; lobos: boolean };
  filesHidden: boolean; // VD-002: the Building Agent login - "Signature hidden", no photos
  history: { status: string; label: string; from: string; note: string | null; by: string; at: string }[];
  canSetStatus: boolean;
};
