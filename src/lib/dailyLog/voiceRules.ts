// Voice entry on the daily site log (29 Oct 2026, Ilies "go") - the plain rules: the switch, the limits, taking
// dollar amounts out, the vocabulary hint for the transcriber, and checking what Claude sends back. Claude's output
// is only ever suggestions the supervisor reviews; this file decides what of it is kept. No server imports;
// `npm test` (voice.test.ts). Design: docs/lci/DAILY-LOG-VOICE-DESIGN.md.
import { assertNoMoney } from "../moneyGuard";
import { DELAY_CODES, NOTE_MAX, type DelayCode } from "./rules";

// ---------- switch and limits ----------

// DAILY_LOG_VOICE=off turns it off. It also needs both keys: OpenAI hears it, Claude tidies it.
export function voiceAvailable(env: { voice?: string; openai?: string; anthropic?: string } = {
  voice: process.env.DAILY_LOG_VOICE, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY,
}): boolean {
  if ((env.voice ?? "").trim().toLowerCase() === "off") return false;
  return !!(env.openai ?? "").trim() && !!(env.anthropic ?? "").trim();
}
export const VOICE_OFF = "Voice isn't available - type it instead.";
// 5 minutes / 10 MB a recording (29 Oct 2026, Ilies: capacity for a lot to say; ~14 KB/s, so 5 min is ~4-5 MB and
// OpenAI takes up to 25 MB). Still 20 a link a day. The phone warns at 4:30 and stops and sends at 5:00.
export const VOICE_LIMITS = { perLinkPerDay: 20, maxBytes: 10 * 1024 * 1024, maxSeconds: 300, warnAtSeconds: 270 };
// The server answers inside the Cloudflare tunnel's 100-second limit: transcription up to 60 s, then the tidy-up gets
// what's left of ~95 s (up to 90 s). If the tidy-up runs out of time the supervisor gets their own words to edit.
export const VOICE_TIMEOUTS = { transcribeMs: 60_000, cleanMaxMs: 90_000, totalMs: 95_000, cleanMinMs: 10_000 };
export const cleanBudgetMs = (elapsedMs: number) =>
  Math.max(VOICE_TIMEOUTS.cleanMinMs, Math.min(VOICE_TIMEOUTS.cleanMaxMs, VOICE_TIMEOUTS.totalMs - elapsedMs));
export const TOO_LONG = "That recording is too long - keep it under 5 minutes.";
export const UP_TO = "Recordings are up to 5 minutes.";
export const VOICE_CAP_REACHED = "That's the most recordings this link can make today - type the rest instead.";
export const overVoiceCap = (usedToday: number) => usedToday >= VOICE_LIMITS.perLinkPerDay;

// ---------- money ----------

export const AMOUNTS_NOTICE = "Amounts aren't recorded here - tell the office.";
const NUMBER_WORDS = "a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and|half";
// A rate after an amount goes with it: "$80 an hour", "$850/day", "45 dollars per tonne".
const RATE = String.raw`(?:\s?(?:\/|per\b|an?\b|each\b)\s?(?:h|hr|hrs|hour|day|week|wk|month|t|tonne|ton|m3|load|bin|man|person)s?\b)?`;
const MONEY_PATTERNS = [
  // $500, $ 1,250.50, A$300, $2k, $1.5 million (+ a rate)
  new RegExp(String.raw`(?:\b(?:AUD|A)\s?)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|thousand|grand)\b)?` + RATE, "gi"),
  new RegExp(String.raw`\bAUD\s?\d[\d,]*(?:\.\d+)?\b` + RATE, "gi"),
  // 500 dollars, 2.5k bucks, 30 cents (+ a rate)
  new RegExp(String.raw`\b\d[\d,]*(?:\.\d+)?\s?(?:k\s?)?(?:dollars?|bucks|cents?|grand)\b` + RATE, "gi"),
  // five hundred dollars, a couple of grand, twenty bucks (+ a rate)
  new RegExp(String.raw`\b(?:(?:${NUMBER_WORDS}|couple(?: of)?|few)[\s-]+)+(?:dollars?|bucks|grand|cents?)\b` + RATE, "gi"),
];
const AMOUNT_TAG = "(amount not recorded)";
// Every dollar amount out of a piece of text. `removed` says whether there was one (the screen then shows AMOUNTS_NOTICE).
export function stripMoney(text: string): { text: string; removed: boolean } {
  let out = text, removed = false;
  for (const re of MONEY_PATTERNS) out = out.replace(re, () => { removed = true; return AMOUNT_TAG; });
  // Anything the guard would still flag (a "$" followed by a digit in some other shape) goes too.
  if (!assertNoMoney(out)) { out = out.replace(/\$\s?\d[\d.,]*/g, AMOUNT_TAG); removed = true; }
  return { text: out, removed };
}

// ---------- the transcriber's vocabulary hint ----------

// Built on the server from that one job only: who's on it, the machines on the board, the site, the activity-code
// names. Names only - nothing that looks like a number with a $ survives, and nothing else is ever passed in.
export type VocabularyInput = { site: string; crew: string[]; plant: string[]; codes: string[] };
export const VOCAB_MAX = 1500;
export function buildVocabulary(v: VocabularyInput): string {
  // A name that carried an amount loses it, and the brackets / dash it sat in.
  const clean = (s: string) =>
    stripMoney(s).text.replace(/\(amount not recorded\)/g, "").replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+[-–]\s*$/, "").replace(/\s+/g, " ").trim();
  const uniq = (xs: string[]) => [...new Set(xs.map(clean).filter((x) => x.length > 1))];
  const parts = [
    v.site && `Site: ${clean(v.site)}.`,
    uniq(v.crew).length && `Crew: ${uniq(v.crew).join(", ")}.`,
    uniq(v.plant).length && `Plant: ${uniq(v.plant).join(", ")}.`,
    uniq(v.codes).length && `Work types: ${uniq(v.codes).join("; ")}.`,
  ].filter(Boolean) as string[];
  const prompt = `A demolition / construction supervisor in Australia talking through their day on site. ${parts.join(" ")}`;
  return prompt.slice(0, VOCAB_MAX);
}

// ---------- what Claude sends back ----------

export const HEADINGS = ["Work done", "Delays", "Plant", "Tip runs", "Safety & issues", "Tomorrow"] as const;
// One heading's text at most (29 Oct 2026: 2500). One recording's cleaned note is also kept within NOTE_MAX: if six
// long headings would pass it, the last ones are shortened at a sentence and "Check this" says so - never quietly.
export const SECTION_MAX = 2500;
export const SHORTENED = "This was very long, so the end of it was shortened - check it and type anything that's missing.";
export type Heading = (typeof HEADINGS)[number];
export type CleanedSection = { heading: Heading; text: string };
export type SuggestedDelay = { delayCode: DelayCode; hoursLost: number | null; note: string };
export type Cleaned = { sections: CleanedSection[]; delays: SuggestedDelay[]; checkThis: string[]; amountsRemoved: boolean };

// The strict JSON schema Claude answers in.
export const CLEAN_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { heading: { type: "string", enum: [...HEADINGS] }, text: { type: "string", description: "Clear sentences, only what was said." } },
        required: ["heading", "text"], additionalProperties: false,
      },
    },
    delays: {
      type: "array",
      items: {
        type: "object",
        properties: {
          delayCode: { type: "string", enum: [...DELAY_CODES] },
          hoursLost: { type: ["number", "null"], description: "Hours lost, only if a number of hours was said. Otherwise null." },
          note: { type: "string", description: "What held them up, in a few words, only what was said." },
        },
        required: ["delayCode", "hoursLost", "note"], additionalProperties: false,
      },
    },
    checkThis: { type: "array", items: { type: "string" }, description: "Anything unclear, a word you weren't sure of, or something that needs the supervisor to confirm. Never a guess." },
  },
  required: ["sections", "delays", "checkThis"], additionalProperties: false,
} as const;

const textOf = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
// Plain code decides what is kept: known headings only (in the standard order, one each), known delay codes only,
// hours between 0 and 24 or null, text capped, every dollar amount taken out again. Anything else is dropped.
export function validateCleaned(raw: unknown, transcriptHadAmounts = false): Cleaned {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let removed = transcriptHadAmounts;
  const noMoney = (s: string) => { const x = stripMoney(s); if (x.removed) removed = true; return x.text; };
  // Anything cut - a heading past SECTION_MAX, or the note past NOTE_MAX - ends on a full sentence and is flagged.
  let shortened = false;
  const fit = (text: string, max: number) => {
    if (text.length <= max) return text;
    shortened = true;
    const cut = text.slice(0, Math.max(0, max));
    const stop = cut.lastIndexOf(". ");
    if (stop > 0) return cut.slice(0, stop + 1).trim(); // at the last full sentence
    const space = cut.lastIndexOf(" ", max - 1);
    return space > 0 ? `${cut.slice(0, space).trim()}…` : ""; // else at a word, marked
  };
  const byHeading = new Map<Heading, string>();
  for (const s of Array.isArray(r.sections) ? r.sections.slice(0, 12) : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    const heading = HEADINGS.find((h) => h === o.heading);
    const text = noMoney(textOf(o.text, SECTION_MAX * 4)); // read generously, then cut at a sentence below
    if (!heading || !text) continue;
    byHeading.set(heading, fit(byHeading.has(heading) ? `${byHeading.get(heading)} ${text}` : text, SECTION_MAX));
  }
  // The whole cleaned note within NOTE_MAX (heading labels and line breaks included).
  let room = NOTE_MAX;
  const sections: CleanedSection[] = [];
  for (const h of HEADINGS.filter((x) => byHeading.has(x))) {
    const label = `${h}: `.length + (sections.length ? 1 : 0);
    let text = byHeading.get(h)!;
    if (label + text.length > room) {
      if (room - label < 40) { shortened = true; break; } // no real room left: the rest is left out (and flagged)
      text = fit(text, room - label);
    }
    if (!text) break;
    sections.push({ heading: h, text });
    room -= label + text.length;
  }
  const delays: SuggestedDelay[] = [];
  for (const d of Array.isArray(r.delays) ? r.delays.slice(0, 6) : []) {
    const o = (d ?? {}) as Record<string, unknown>;
    const code = DELAY_CODES.find((c) => c === o.delayCode);
    if (!code) continue;
    const h = typeof o.hoursLost === "number" && Number.isFinite(o.hoursLost) && o.hoursLost > 0 && o.hoursLost <= 24 ? Math.round(o.hoursLost * 4) / 4 : null;
    const note = noMoney(textOf(o.note, 300));
    if (code === "OTHER" && !note) continue; // the log needs a note for "Other"
    delays.push({ delayCode: code, hoursLost: h, note });
  }
  const checkThis = (Array.isArray(r.checkThis) ? r.checkThis : []).slice(0, 8).map((c) => noMoney(textOf(c, 200))).filter(Boolean);
  if (shortened) checkThis.unshift(SHORTENED);
  return { sections, delays, checkThis, amountsRemoved: removed };
}

// The cleaned text as one note (what goes in the log's note box for the supervisor to edit). validateCleaned keeps it
// within NOTE_MAX, so it's never cut when the log is sent.
export const cleanedNote = (c: Cleaned) => c.sections.map((s) => `${s.heading}: ${s.text}`).join("\n");
export const FAILED_TO_TEXT = "Couldn't turn that into text - try again or type it.";

// Recordings add up (29 Oct 2026): a recording's text goes under the note so far - nothing there, just the text;
// otherwise a dashed line with the time first. The screen refuses (and says so) if that would pass NOTE_MAX.
export const addToNote = (note: string, text: string, at: Date) => {
  if (!note.trim()) return text;
  const time = at.toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
  return `${note.trimEnd()}\n\n----- ${time} -----\n${text}`;
};
