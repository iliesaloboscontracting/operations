// Daily site log (Task K, LCI phase 1; Ilies approved 25 Oct 2026: "yes to
// all, build"). The plain rules: what a log and a weekly % need, the pilot
// list, the reminder's switch. The supervisor never re-enters hours - the
// crew's signed hours come from sign-ins and are only SPLIT across activity
// codes here. No money anywhere: no rate, cost or price field exists on these
// shapes. No server imports; `npm test` (dailyLog.test.ts).
// Design: docs/lci/PHASE1-DAILY-LOG-DESIGN.md.
import { BY_CODE, CODES, WASTE_CLASSES, isCode } from "../activityCodes";
import { assertNoMoney } from "../moneyGuard";

// Money guard for everything the link sends back: no dollar figure anywhere in it.
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x));

// The split must land within this of the signed hours.
export const SPLIT_TOLERANCE = 0.5;

export const DELAY_CODES = ["WEATHER", "ACCESS", "CLIENT", "PLANT_BREAKDOWN", "WAITING_ON_OTHERS", "OTHER"] as const;
export type DelayCode = (typeof DELAY_CODES)[number];
export const DELAY_LABEL: Record<DelayCode, string> = {
  WEATHER: "Weather", ACCESS: "Access", CLIENT: "Client", PLANT_BREAKDOWN: "Plant breakdown", WAITING_ON_OTHERS: "Waiting on others", OTHER: "Other",
};
export const AFFECTS = ["CREW", "PLANT", "BOTH"] as const;
export const DOCKET_UNITS = ["t", "m3", "loads", "bins"] as const;
export const UNIT_LABEL: Record<string, string> = { t: "t", m3: "m³", loads: "loads", bins: "bins" };
// Tip dockets go against the codes that carry a waste class (DEM-10 waste load-out, CIV-02 spoil export).
export const DOCKET_CODES = CODES.filter((c) => c.wasteClasses).map((c) => c.code);
export const ACM = "Asbestos (ACM)";
export const LIMITS = { codes: 15, plant: 20, delays: 6, dockets: 20, logPhotos: 4, delayPhotos: 4, logsPerLinkPerDay: 20 };
// The log's note (typed, or the supervisor's voice cleaned up - several recordings add up). 12000 since 29 Oct 2026
// (Ilies: "the guys will have a lot to say so ensure we have capacity for it"). A cleaned recording is kept within it
// (voiceRules.validateCleaned), and the screen won't add past it - nothing is cut off quietly.
export const NOTE_MAX = 12000;

// ---------- the pilot and the reminder switch ----------

// DAILY_LOG_PILOT_LINKS: the SiteLink ids that see the Daily log card (Damien's and Tom's supervisor links to
// start), or "all" (29 Oct 2026, Ilies "go": every active SUPERVISOR link, new ones included). Empty or unset = off
// for everyone. Whichever it is, a HANDOVER (one-day stand-in) link on one of those supervisors' jobs gets it too;
// OFFICE, POSTER and DRIVER links never do.
export const pilotLinkIds = (raw: string | undefined = process.env.DAILY_LOG_PILOT_LINKS) =>
  (raw ?? "").trim().toLowerCase() === "all" ? new Set<string>() : new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
export type PilotRule = { all: boolean; ids: Set<string> };
export const pilotRule = (raw: string | undefined = process.env.DAILY_LOG_PILOT_LINKS): PilotRule =>
  ({ all: (raw ?? "").trim().toLowerCase() === "all", ids: pilotLinkIds(raw) });
export const pilotOn = (r: PilotRule) => r.all || r.ids.size > 0;
// A supervisor link is on when it's "all" or listed. A hand-over link is on when one of its job's people is on
// (decided in store.ts from the board). Any other kind: never.
export const supervisorOn = (r: PilotRule, linkId: string) => r.all || r.ids.has(linkId);
export const linkGetsLog = (r: PilotRule, link: { kind: string; id: string }, handoverOnRuleJob: boolean) =>
  pilotOn(r) && (link.kind === "SUPERVISOR" ? supervisorOn(r, link.id) : link.kind === "HANDOVER" ? handoverOnRuleJob : false);

// The approved list of automatic internal reminders (A2). Only this rule is on
// it; a new reminder type is a code change with Ilies's OK. Kill switch:
// enabled: false here, or DAILY_LOG_REMINDER=off in .env - Day Review still
// shows the "No site log" badge either way.
export const A2_RULES = {
  DAILY_LOG_REMINDER: { enabled: true, atMinutes: 19 * 60, nightAfterFinishMinutes: 120, noneAfterMinutes: 21 * 60 },
} as const;
export const reminderEnabled = (raw: string | undefined = process.env.DAILY_LOG_REMINDER) =>
  A2_RULES.DAILY_LOG_REMINDER.enabled && (raw ?? "").trim().toLowerCase() !== "off";

// ---------- a log ----------

// What the server already knows when a log comes in (never taken from the phone).
export type LogContext = {
  signedHours: number; // crew's signed hours now (staff + labour hire), less unpaid breaks
  signedCrew: number;
  plant: Map<string, "PLANT" | "TRUCK">; // the job's machines on the board
};

export type ParsedLog = {
  crewOk: boolean; crewNote: string | null; crewCount: number; labourHours: number; splitHours: number;
  hours: { code: string; kind: "LABOUR" | "PLANT" | "TRUCK"; resourceId: string | null; hours: number }[];
  delays: { delayCode: DelayCode; hoursLost: number | null; affects: string; note: string | null; photos: string[] }[];
  dockets: { code: string; wasteClass: string; quantity: number; unit: string; docketNo: string | null; facility: string | null; photo: string | null }[];
  note: string | null; photos: string[]; noDelays: boolean; noDockets: boolean; durationSec: number | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const quarter = (h: number) => Math.round(h * 4) / 4;
const list = (v: unknown) => (Array.isArray(v) ? v : []);
// A photo is a new one from the phone (data URL) or one already on an earlier version (a stored file name).
const photoList = (v: unknown) => list(v).filter((p): p is string => typeof p === "string" && p.length > 0);

export function parseLog(b: Record<string, unknown>, ctx: LogContext): ParsedLog | { error: string } {
  // Who and how long: from sign-ins, unless the supervisor says the list is
  // wrong or nobody signed in - then a crew count and total typed by hand.
  const crewOk = b.crewOk !== false;
  const crewNote = text(b.crewNote, 500) || null;
  let crewCount = ctx.signedCrew, labourHours = quarter(ctx.signedHours);
  if (!crewOk) {
    if (!crewNote) return { error: "Say what's wrong with the crew list - the office will check it." };
    const hc = num(b.handCrew), hh = num(b.handHours);
    if (b.handHours != null && b.handHours !== "") {
      if (!Number.isFinite(hh) || hh <= 0 || hh > 500) return { error: "Crew hours by hand must be a number of hours." };
      if (!Number.isInteger(hc) || hc < 1 || hc > 100) return { error: "How many were on the crew?" };
      crewCount = hc; labourHours = quarter(hh);
    }
  }
  if (labourHours <= 0) return { error: "Nobody signed in on this job - tap \"Something's wrong\" and enter the crew hours by hand." };

  const hours: ParsedLog["hours"] = [];
  const seen = new Set<string>();
  const labour = list(b.hours);
  if (labour.length === 0) return { error: "Split the crew's hours across what they worked on." };
  if (labour.length > LIMITS.codes) return { error: `At most ${LIMITS.codes} codes in one log.` };
  for (const raw of labour) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const code = text(r.code, 10), h = num(r.hours);
    if (!isCode(code)) return { error: `"${code || "?"}" isn't an activity code.` };
    if (seen.has(code)) return { error: `${code} is in the list twice.` };
    if (!Number.isFinite(h) || h <= 0 || h > 500) return { error: `Hours for ${code} must be more than 0.` };
    seen.add(code);
    hours.push({ code, kind: "LABOUR", resourceId: null, hours: quarter(h) });
  }
  const splitHours = quarter(hours.reduce((s, x) => s + x.hours, 0));
  if (!splitFits(splitHours, labourHours)) {
    const left = quarter(labourHours - splitHours);
    return { error: left > 0 ? `${left} h still to place on a code (${labourHours} h signed).` : `That's ${-left} h more than the crew's ${labourHours} h.` };
  }

  const plantRows = list(b.plant);
  if (plantRows.length > LIMITS.plant) return { error: "Too many machines in one log." };
  const plantSeen = new Set<string>();
  for (const raw of plantRows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const resourceId = text(r.resourceId, 40), code = text(r.code, 10), h = num(r.hours);
    const kind = ctx.plant.get(resourceId);
    if (!kind) return { error: "A machine in the log isn't on this job's board." };
    if (plantSeen.has(resourceId)) return { error: "A machine is in the log twice." };
    plantSeen.add(resourceId);
    if (!Number.isFinite(h) || h < 0 || h > 24) return { error: "Machine hours must be between 0 and 24." };
    if (h === 0) continue; // on the board but didn't work - left out
    if (!isCode(code)) return { error: `"${code || "?"}" isn't an activity code.` };
    hours.push({ code, kind, resourceId, hours: quarter(h) });
  }

  const noDelays = b.noDelays === true;
  const delays: ParsedLog["delays"] = [];
  const delayRows = noDelays ? [] : list(b.delays);
  if (delayRows.length > LIMITS.delays) return { error: `At most ${LIMITS.delays} delays in one log.` };
  for (const raw of delayRows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const delayCode = text(r.delayCode, 30) as DelayCode;
    if (!DELAY_CODES.includes(delayCode)) return { error: "Pick what held you up." };
    const lost = r.hoursLost == null || r.hoursLost === "" ? null : num(r.hoursLost);
    if (lost != null && (!Number.isFinite(lost) || lost < 0 || lost > 24)) return { error: "Hours lost must be between 0 and 24." };
    const affects = (AFFECTS as readonly string[]).includes(String(r.affects)) ? String(r.affects) : "CREW";
    const photos = photoList(r.photos);
    if (photos.length > LIMITS.delayPhotos) return { error: `At most ${LIMITS.delayPhotos} photos for a delay.` };
    const note = text(r.note, 500) || null;
    if (delayCode === "OTHER" && !note) return { error: "Say what held you up." };
    delays.push({ delayCode, hoursLost: lost == null ? null : quarter(lost), affects, note, photos });
  }

  const noDockets = b.noDockets === true;
  const dockets: ParsedLog["dockets"] = [];
  const docketRows = noDockets ? [] : list(b.dockets);
  if (docketRows.length > LIMITS.dockets) return { error: `At most ${LIMITS.dockets} dockets in one log.` };
  for (const raw of docketRows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const d = parseDocket(r);
    if ("error" in d) return d;
    dockets.push(d);
  }

  const photos = photoList(b.photos);
  if (photos.length > LIMITS.logPhotos) return { error: `At most ${LIMITS.logPhotos} photos of the day.` };
  const dur = num(b.durationSec);
  return {
    crewOk, crewNote, crewCount, labourHours, splitHours, hours, delays, dockets,
    note: text(b.note, NOTE_MAX) || null, photos, noDelays: noDelays || delays.length === 0, noDockets: noDockets || dockets.length === 0,
    durationSec: Number.isFinite(dur) && dur >= 0 && dur <= 86_400 ? Math.round(dur) : null,
  };
}

export const splitFits = (split: number, signed: number) => Math.abs(split - signed) <= SPLIT_TOLERANCE + 1e-9;

export function parseDocket(r: Record<string, unknown>): ParsedLog["dockets"][number] | { error: string } {
  const code = text(r.code, 10) || "DEM-10";
  if (!DOCKET_CODES.includes(code)) return { error: `Dockets go on ${DOCKET_CODES.join(" or ")}.` };
  const wasteClass = text(r.wasteClass, 60);
  if (!(WASTE_CLASSES as readonly string[]).includes(wasteClass) || !BY_CODE[code].wasteClasses?.includes(wasteClass)) return { error: "Pick the docket's waste class." };
  const quantity = num(r.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) return { error: "Enter the docket's amount." };
  const unit = text(r.unit, 10);
  if (!(DOCKET_UNITS as readonly string[]).includes(unit)) return { error: "Pick t, m³, loads or bins." };
  const photo = typeof r.photo === "string" && r.photo ? r.photo : null;
  if (wasteClass === ACM && !photo) return { error: "An asbestos docket needs a photo of the docket." };
  return { code, wasteClass, quantity: Math.round(quantity * 100) / 100, unit, docketNo: text(r.docketNo, 40) || null, facility: text(r.facility, 80) || null, photo };
}

// The next version number for a job's log (1 for the first).
export const nextRevision = (existing: number[]) => (existing.length ? Math.max(...existing) : 0) + 1;

// ---------- weekly % complete ----------

export type ProgressKey = { packageId: string | null; code: string };
export const progressKey = (k: ProgressKey) => k.packageId ? `pkg:${k.packageId}` : `code:${k.code}`;

export type ParsedProgressLine = { packageId: string | null; code: string; label: string; pctComplete: number; reason: string | null };

// One week's lines. `allowed` is what may be reported (the approved budget's
// packages, or the codes logged on the project so far); `last` is each line's
// previous % - going down needs a reason (rework, scope change...).
export function parseProgress(
  b: Record<string, unknown>,
  allowed: Map<string, { packageId: string | null; code: string; label: string }>,
  last: Map<string, number>,
): ParsedProgressLine[] | { error: string } {
  const rows = list(b.lines);
  if (rows.length === 0) return { error: "Nothing to save." };
  if (rows.length > 60) return { error: "Too many lines." };
  const out: ParsedProgressLine[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const key = progressKey({ packageId: text(r.packageId, 80) || null, code: text(r.code, 10) });
    const line = allowed.get(key);
    if (!line) return { error: "A line isn't one of this job's packages or codes." };
    if (seen.has(key)) return { error: `${line.label} is in the list twice.` };
    seen.add(key);
    const pct = num(r.pct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return { error: `% complete for ${line.label} must be 0 to 100.` };
    const reason = text(r.reason, 300) || null;
    const before = last.get(key);
    if (before != null && pct < before && !reason) return { error: `${line.label} went down from ${before}% - say why (e.g. rework, scope change).` };
    out.push({ ...line, pctComplete: pct, reason });
  }
  return out;
}
