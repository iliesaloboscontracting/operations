// Voice entry on the daily site log (29 Oct 2026, Ilies "go") - the plain rules: the switch, the limits, taking
// dollar amounts out, the vocabulary hint for the transcriber, and checking what Claude sends back. Claude's output
// is only ever suggestions the supervisor reviews; this file decides what of it is kept. No server imports;
// `npm test` (voice.test.ts). Design: docs/lci/DAILY-LOG-VOICE-DESIGN.md.
import { assertNoMoney } from "../moneyGuard";
import { DELAY_CODES, type DelayCode } from "./rules";

// ---------- switch and limits ----------

// DAILY_LOG_VOICE=off turns it off. It also needs both keys: OpenAI hears it, Claude tidies it.
export function voiceAvailable(env: { voice?: string; openai?: string; anthropic?: string } = {
  voice: process.env.DAILY_LOG_VOICE, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY,
}): boolean {
  if ((env.voice ?? "").trim().toLowerCase() === "off") return false;
  return !!(env.openai ?? "").trim() && !!(env.anthropic ?? "").trim();
}
export const VOICE_OFF = "Voice isn't available - type it instead.";
export const VOICE_LIMITS = { perLinkPerDay: 20, maxBytes: 5 * 1024 * 1024, maxSeconds: 120 };
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
  const byHeading = new Map<Heading, string>();
  for (const s of Array.isArray(r.sections) ? r.sections.slice(0, 12) : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    const heading = HEADINGS.find((h) => h === o.heading);
    const text = noMoney(textOf(o.text, 1200));
    if (!heading || !text) continue;
    byHeading.set(heading, byHeading.has(heading) ? `${byHeading.get(heading)} ${text}`.slice(0, 1200) : text);
  }
  const sections = HEADINGS.filter((h) => byHeading.has(h)).map((h) => ({ heading: h, text: byHeading.get(h)! }));
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
  return { sections, delays, checkThis, amountsRemoved: removed };
}

// The cleaned text as one note (what goes in the log's note box for the supervisor to edit).
export const cleanedNote = (c: Cleaned) => c.sections.map((s) => `${s.heading}: ${s.text}`).join("\n").slice(0, 2000);
