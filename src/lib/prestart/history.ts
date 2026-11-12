// A machine's checks & service history (Ilies, 12 Nov 2026: "Should allow pre and post starts and show service history..
// if the build wants to check the guys did the prestart they can scan. if they want to check service history.. allow
// these to be downloaded if they need them."). Read-only, from the plant QR sticker (no name needed) and the Plant page.
// The plain rules, no database code - `npm test` (history.test.ts):
//   - the window: the last 7 / 30 / 90 days (default 90), newest first, at most MAX_CHECKS checks;
//   - only the one machine's rows (filtered again here, whatever the query returned);
//   - every DTO built field by field - never a spread row. No amount, invoice number or total, rate or price: a service
//     record's own money fields are never read, and its words (work done, provider, register note, fault words) keep
//     no figure at all (`publicWords`, PS-059); an invoices-inbox record shows only "Service (mechanic's invoice)";
//     `linkSafe` stays the backstop on every reply. No coordinates, phones or device ids;
//   - the QR ("public") gets only the service-due / inspection dates (PS-061) and no check ids (PS-064); the Plant page
//     ("office") gets all its dates and the ids.
import { nameWithoutAmounts, linkLabel, NUMBER_WORDS } from "../dailyLog/money";
import { dueSummary } from "../assets/rules";
import { toCsv } from "../payroll/rules";
import { PRIORITY_LABEL, STATUS_LABEL, isOpenStatus, priorityRank, type FaultPriority, type FaultStatus } from "./rules";

export const HISTORY_DAYS = [7, 30, 90] as const;
export type HistoryDays = (typeof HISTORY_DAYS)[number];
export const parseDays = (v: unknown): HistoryDays => {
  const n = Number(v);
  return (HISTORY_DAYS as readonly number[]).includes(n) ? (n as HistoryDays) : 90;
};
export const MAX_CHECKS = 400; // 90 days of busy use; the rest is on the office's Checks tab
export const MAX_SERVICES = 20;
export const WHAT = ["checks", "service"] as const;
export type HistoryWhat = (typeof WHAT)[number];
export const parseWhat = (v: unknown): HistoryWhat => (v === "service" ? "service" : "checks");

const DAY_MS = 24 * 60 * 60 * 1000;
const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const sydneyClock = (d: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }).format(d);

// Free text that came from an invoice or a person (service work, provider, fault words): every dollar amount out (the
// daily log's patterns), then what an invoice line can still carry without a "$" - prices with cents ("450.00"),
// thousands ("1,250"), "@ 120", "total 450", "ex GST" - then the spaces tidied. Never refuses: what's left is words.
export function noAmounts(s: string | null | undefined, max = 200): string | null {
  if (!s) return null;
  const t = nameWithoutAmounts(s.replace(/[＄﹩]/g, "$").replace(/\s+/g, " "))
    .replace(/\b(?:sub\s?total|total|amount|price|cost|rate|charge|labour charge|gst)\s*[:=]?\s*(?:inc\.?|ex\.?|incl\.?)?\s*\d[\d,]*(?:\.\d+)?/gi, "")
    .replace(/[@=]\s*\d[\d,]*(?:\.\d+)?(?:\s?(?:\/|per)\s?\w+)?/g, "")
    // ...but a reading stays: "1,250 hrs", "12,400 km".
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b(?!\s?(?:hrs?|hours?|h|kms?|kilometres?)\b)/gi, "")
    .replace(/\b\d+\.\d{2}\b(?!\s?(?:hrs?|hours?|h|kms?|kilometres?)\b)/gi, "")
    .replace(/\b(?:ex|inc|incl)\.?\s*gst\b/gi, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:[,;:\-–]\s*){2,}/g, ", ")
    .replace(/,\s*\./g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, "")
    .trim();
  return t ? t.slice(0, max) : null;
}

// PS-059 (Ilies approved 12 Nov 2026: "no amounts or figure shown"): free text a person or an invoice wrote - typed
// service work, the provider, the Plant register's "service due" note, fault words - with NO figure left in it at all.
// Invoice references go, then every digit sequence (decimals, commas, an attached unit or rate: /hr, /day, each, hrs,
// km, inc / ex GST), then the money words left behind (AUD, GST, ex, inc, total, cost, price, rate), then the spaces
// tidied, then noAmounts. A model number ("CAT 320") loses its number - the machine's name is shown on its own. Hour
// meter and odometer readings are shown only from their own numeric fields, never inside text.
const UNIT = String.raw`(?:\s?(?:\/\s?|per\s+)(?:hrs?|hours?|h|day|days|wk|week|t|tonne|m|km|ea|each|load)\b|\s?(?:hrs?|hours?|h|kms?|k|ltrs?|litres?|l|mm|t|ea|each)\b)?`;
export function publicWords(s: string | null | undefined, max = 200): string | null {
  if (!s) return null;
  // PS-065: NFKC first - full-width, superscript and circled digits become 0-9, full-width "$" becomes "$".
  let t = s.normalize("NFKC").replace(/[＄﹩]/g, "$").replace(/\s+/g, " ")
    // invoice references: "tax invoice no. 1234", "inv # A-77", "invoice number: 99", "INV-10234"
    .replace(/\b(?:tax\s+)?(?:invoice|inv)\b\.?\s*(?:no\b\.?|number\b|num\b\.?|#)?\s*[:#]?\s*(?:[A-Za-z]{0,4}[-\/]?\d[\w\/-]*)?/gi, " ")
    .replace(/\bINV-?\d+\b/gi, " ")
    // every figure, with what hangs off it
    .replace(new RegExp(String.raw`\$?\s?\d[\d,.]*` + UNIT + String.raw`(?:\s*(?:inc|incl|ex)\.?\s*gst\b)?`, "gi"), " ")
    .replace(/\p{N}+/gu, " ") // PS-065: any digit in any script (Arabic-Indic, ...), not just 0-9
    // PS-065: a figure in words - two or more number-words in a row with a real number in them ("four fifty", "one
    // thousand two hundred"). One on its own ("one hose") and runs of only a / an / and / half stay.
    .replace(NUMBER_RUN, (m) => (NUMBER_CORE.test(m) ? " " : m))
    // the money words left behind
    .replace(/\b(?:sub\s?total|total|cost|price|labour\s+rate|rate|charge)(?:\s+(?:was|is|of))?\b/gi, " ")
    .replace(/\b(?:aud|gst|incl|inc|ex)\b\.?/gi, " ")
    .replace(/\$/g, " ")
    .replace(/(^|\s)[+=@×*\/x](?=\s|$)/g, " ")
    .replace(/\(\s*[x×@#+=]?\s*\)|\[\s*[x×@#+=]?\s*\]/gi, " ");
  t = t.replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").replace(/[\s,;:.\-–+=@\/(]+$/g, "").replace(/^[\s,;:.\-–+=@\/)]+/g, "").trim();
  const out = noAmounts(t, max);
  return out && !/\p{N}/u.test(out) ? out : out ? out.replace(/\p{N}+/gu, "").replace(/\s+/g, " ").trim() || null : null;
}
const NUMBER_RUN = new RegExp(String.raw`\b(?:(?:${NUMBER_WORDS})\b[\s-]*){2,}`, "gi");
const NUMBER_CORE = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i;

// ---------- the rows ----------

export type RawCheck = {
  id: string; resourceId: string; kind: string; createdAt: Date; personName: string; sessionId: string | null;
  hourMeter: number | null; hourMeterFlag: string | null; hourMeterWrongAt: Date | null;
  answers: string; walkaround: string | null; seenCount: number;
  faults: { itemLabel: string | null; description: string; priority: string; status: string }[];
};
export type FaultLine = { item: string | null; description: string | null; priority: string; priorityLabel: string; status: string; statusLabel: string };
export type CheckRow = {
  id?: string; // the office's only (PS-064) - the QR's reply leaves it out
  date: string; time: string; kind: "PRE" | "POST"; kindLabel: string; operator: string;
  hourMeter: number | null; hourMeterNote: string | null;
  allOk: boolean; failed: string[]; notApplicable: number;
  walkaround: string | null; stillThere: number; faults: FaultLine[];
};

const answersOf = (json: string): { label: string; answer: string }[] => {
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x) => x && typeof x === "object").map((x) => ({ label: String(x.label ?? x.key ?? ""), answer: String(x.answer ?? "") })) : [];
  } catch { return []; }
};
const WALKAROUND: Record<string, string> = { DONE: "Walk-around photos taken", LIMIT: "Walk-around photos skipped (day's photo limit)", OPTIONAL: "Walk-around done earlier today" };

export const faultLine = (f: { itemLabel: string | null; description: string; priority: string; status: string }): FaultLine => ({
  item: noAmounts(f.itemLabel, 80), // our own checklist labels
  description: publicWords(f.description, 300), // PS-059: operator-written words, no figures
  priority: f.priority,
  priorityLabel: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority,
  status: f.status,
  statusLabel: STATUS_LABEL[f.status as FaultStatus] ?? f.status,
});

export function checkRow(c: RawCheck, company: string | null): CheckRow {
  const answers = answersOf(c.answers);
  const failed = answers.filter((a) => a.answer === "FAULT").map((a) => noAmounts(a.label, 80) ?? "Item");
  const person = nameWithoutAmounts(c.personName) || "Operator";
  const co = company ? nameWithoutAmounts(company) : "";
  return {
    id: c.id,
    date: sydneyDay(c.createdAt),
    time: sydneyClock(c.createdAt),
    kind: c.kind === "POST" ? "POST" : "PRE",
    kindLabel: c.kind === "POST" ? "End of shift" : "Start of shift",
    operator: co ? `${person} (${co})` : person,
    hourMeter: c.hourMeter,
    hourMeterNote: c.hourMeterWrongAt ? "Marked wrong by the office" : c.hourMeterFlag === "LOWER" ? "Lower than the last reading" : c.hourMeterFlag === "HIGHER" ? "Much higher than the last reading" : null,
    allOk: failed.length === 0,
    failed,
    notApplicable: answers.filter((a) => a.answer === "NA").length,
    walkaround: c.walkaround ? WALKAROUND[c.walkaround] ?? null : null,
    stillThere: c.seenCount,
    faults: c.faults.map(faultLine),
  };
}

export type RawService = { resourceId: string; date: string; work: string | null; mechanic: string | null; odometer: number | null; invoiceDraftId?: string | null };
export type ServiceRow = { date: string; work: string; provider: string | null; reading: number | null };
export const INVOICE_SERVICE = "Service (mechanic's invoice)";
// Field by field: the record's amountExGst / gst / total / invoiceNo / notes are never read. PS-059: a record made from
// the invoices inbox (invoiceDraftId) never shows the invoice's wording - its work is INVOICE_SERVICE; typed work and
// the provider go through publicWords (no figure at all); work that cleans to nothing is "Service". The reading comes
// only from its own field.
export const serviceRow = (s: RawService): ServiceRow => ({
  date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : String(s.date).slice(0, 10),
  work: s.invoiceDraftId ? INVOICE_SERVICE : publicWords(s.work, 300) ?? "Service",
  provider: s.mechanic ? publicWords(linkLabel(s.mechanic, ""), 80) : null,
  reading: typeof s.odometer === "number" ? s.odometer : null,
});

export type RawFault = { resourceId: string; itemLabel: string | null; description: string; priority: string; status: string; reportedAt: Date };
export type OpenFault = FaultLine & { reportedOn: string };
export type DateLine = { label: string; expiryDate: string | null; state: string };

export type MachineHistory = {
  machine: string; down: boolean; doNotUse: boolean; generatedAt: string; generatedOn: string; days: HistoryDays;
  checks: CheckRow[]; truncated: boolean; photosNote: string;
  service: { nextDue: DateLine | null; registerNote: string | null; dates: DateLine[]; records: ServiceRow[]; openFaults: OpenFault[] };
};

// Who it's for: "public" = the plant QR (anyone holding the sticker), "office" = the Plant page (Managers / Admins).
export type Audience = "public" | "office";
// PS-061 (Ilies, 12 Nov 2026: insurance / rego NOT public): the QR shows only these asset dates; the office sees them all.
export const PUBLIC_DATE_KINDS = ["SERVICE_DUE", "PLANT_INSPECTION"];

// Everything for one machine. `machineId` filters every list again - only this machine, whatever came in.
export function buildHistory(input: {
  machineId: string; machineName: string; status: string | null; serviceDue: string | null;
  checks: RawCheck[]; companies: Map<string, string | null>; services: RawService[];
  docs: { resourceId: string | null; kind: string; status: string; expiryDate: string | null }[];
  faults: RawFault[]; days: HistoryDays; now: Date; audience?: Audience;
}): MachineHistory {
  const pub = input.audience !== "office"; // public unless the office route says so
  const since = input.now.getTime() - input.days * DAY_MS;
  const mine = input.checks
    .filter((c) => c.resourceId === input.machineId && c.createdAt.getTime() >= since && c.createdAt.getTime() <= input.now.getTime() + 60_000)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const today = sydneyDay(input.now);
  const due = dueSummary(input.docs.filter((d) => d.resourceId === input.machineId), today, { vehicle: false });
  const dates: DateLine[] = due.lines
    .filter((l) => !pub || PUBLIC_DATE_KINDS.includes(l.kind))
    .map((l) => ({ label: l.label, expiryDate: l.expiryDate, state: l.state }));
  const open = input.faults
    .filter((f) => f.resourceId === input.machineId && isOpenStatus(f.status))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.reportedAt.getTime() - a.reportedAt.getTime())
    .map((f) => ({ ...faultLine(f), reportedOn: sydneyDay(f.reportedAt) }));
  return {
    machine: linkLabel(input.machineName, "Machine"),
    down: input.status === "DOWN",
    doNotUse: input.status === "DOWN" || open.some((f) => f.priority === "DO_NOT_USE"),
    generatedAt: `${today} ${sydneyClock(input.now)}`,
    generatedOn: today,
    days: input.days,
    checks: mine.slice(0, MAX_CHECKS).map((c) => {
      const row = checkRow(c, c.sessionId ? input.companies.get(c.sessionId) ?? null : null);
      if (!pub) return row;
      const { id: _id, ...rest } = row; // PS-064: no record ids on the QR
      return rest;
    }),
    truncated: mine.length > MAX_CHECKS,
    photosNote: "Walk-around and hour-meter photos are kept with the office (Faults page, Checks tab).",
    service: {
      nextDue: dates.find((d) => d.label === "Service due") ?? null,
      registerNote: publicWords(input.serviceDue, 60), // PS-059
      dates,
      records: input.services
        .filter((s) => s.resourceId === input.machineId)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, MAX_SERVICES)
        .map(serviceRow),
      openFaults: open,
    },
  };
}

// The built-in Helvetica only has the Windows-1252 characters: anything else in a name or a fault (an emoji, an arrow)
// is swapped or dropped, so it can't print as junk.
const CP1252_EXTRA = "–—‘’‚“”„•…€™‰‹›ŠšŽžŒœŸˆ˜†‡ƒ";
export const pdfText = (s: string) =>
  s.replace(/[→⇒]/g, "->").replace(/−/g, "-").replace(/[‐-‒]/g, "-")
    .split("").filter((ch) => /[\x20-\x7E\xA0-\xFF]/.test(ch) || CP1252_EXTRA.includes(ch)).join("");

// ---------- the CSV ----------

// The same escaping as the payroll files (lib/payroll/rules.ts csvCell): a cell starting = + - @ (or tab / CR) is quoted
// and prefixed with ', so a name or a fault can never become a spreadsheet formula.
export const STATE_LABEL: Record<string, string> = { EXPIRED: "Overdue", EXPIRING: "Due soon", VALID: "OK", NO_EXPIRY: "No date", NOT_RECORDED: "Not recorded" };

export function checksCsv(h: MachineHistory): string {
  const rows: (string | number | null)[][] = [
    ["Lobos Contracting – pre-start records"], ["Machine", h.machine], ["Generated", h.generatedAt], ["Range", `Last ${h.days} days`], [],
    ["Date", "Time", "Check", "Operator", "Hour meter", "Hour meter note", "Checklist", "Items failed", "Faults raised", "Known faults still there", "Walk-around"],
  ];
  for (const c of h.checks) {
    rows.push([
      c.date, c.time, c.kindLabel, c.operator, c.hourMeter, c.hourMeterNote,
      c.allOk ? "All OK" : `${c.failed.length} failed`, c.failed.join("; "),
      c.faults.map((f) => [f.item, f.description, f.priorityLabel, f.statusLabel].filter(Boolean).join(" - ")).join("; "),
      c.stillThere || null, c.walkaround,
    ]);
  }
  if (h.truncated) rows.push([], [`Only the newest ${MAX_CHECKS} checks - the office has the rest.`]);
  return toCsv(rows);
}

export function serviceCsv(h: MachineHistory): string {
  const rows: (string | number | null)[][] = [
    ["Lobos Contracting – service history"], ["Machine", h.machine], ["Generated", h.generatedAt], [],
    ["Dates", "Date", "State"],
    ...h.service.dates.map((d) => [d.label, d.expiryDate ?? "Not recorded", STATE_LABEL[d.state] ?? d.state]),
    ...(h.service.registerNote ? [["Service due (register)", h.service.registerNote, ""]] : []),
    [],
    ["Service date", "Work done", "Provider", "Odometer / hours"],
    ...h.service.records.map((s) => [s.date, s.work, s.provider, s.reading]),
    [],
    ["Open faults", "Item", "Description", "Priority", "Status", "Reported"],
    ...h.service.openFaults.map((f) => ["", f.item, f.description, f.priorityLabel, f.statusLabel, f.reportedOn]),
  ];
  return toCsv(rows);
}

export const fileName = (h: MachineHistory, what: HistoryWhat, ext: "pdf" | "csv") =>
  `${(h.machine.replace(/[^\w\- ]+/g, "").trim() || "Machine")} - ${what === "service" ? "service history" : `pre-starts ${h.days} days`} ${h.generatedOn}.${ext}`;
