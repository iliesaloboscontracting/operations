// Voice entry on the daily site log (29 Oct 2026, Ilies "go") - the plain rules: the switch, the limits, taking
// dollar amounts out, the vocabulary hint for the transcriber, and checking what Claude sends back. Claude's output
// is only ever suggestions the supervisor reviews; this file decides what of it is kept. No server imports;
// `npm test` (voice.test.ts). Design: docs/lci/DAILY-LOG-VOICE-DESIGN.md.
import { DELAY_CODES, NOTE_MAX, type DelayCode } from "./rules";
import { nameWithoutAmounts, stripMoney } from "./money";
import { FILL_SCHEMA_PROPS, NO_FILL, validateFill, type Fill, type FillContext } from "./fill";

// ---------- switch and limits ----------

// DAILY_LOG_VOICE=off turns it off. It also needs both keys: OpenAI hears it, Claude tidies it.
export function voiceAvailable(env: { voice?: string; openai?: string; anthropic?: string } = {
  voice: process.env.DAILY_LOG_VOICE, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY,
}): boolean {
  if ((env.voice ?? "").trim().toLowerCase() === "off") return false;
  return !!(env.openai ?? "").trim() && !!(env.anthropic ?? "").trim();
}
export const VOICE_OFF = "Voice isn't available - type it instead.";
// 5 minutes a recording (29 Oct 2026, Ilies: capacity for a lot to say). ~14 KB/s measured, so 5 minutes is ~4.2 MB
// (an iPhone's audio/mp4 at ~64-96 kbit/s is 2.4-3.6 MB): the audio may be up to 6 MB and the whole request up to
// 6.25 MB (security review SEC-003). Still 20 a link a day. The phone warns at 4:30 and stops and sends at 5:00.
export const VOICE_LIMITS = { perLinkPerDay: 20, maxBytes: 6 * 1024 * 1024, maxRequestBytes: 6.25 * 1024 * 1024, maxSeconds: 300, warnAtSeconds: 270 };
// Everyone together: at most DAILY_LOG_VOICE_DAY_MAX recordings a Sydney day (default 300) - SEC-001.
export const dayCeiling = (raw: string | undefined = process.env.DAILY_LOG_VOICE_DAY_MAX) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 300;
};
export const overDayCeiling = (usedToday: number, max = dayCeiling()) => usedToday >= max;
export const ONE_AT_A_TIME = "One recording at a time - wait for the last one to finish.";
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

// Taking amounts out lives in ./money.ts (shared with the typed log fields - SEC-002); re-exported for the voice code.
export { AMOUNTS_NOTICE, AMOUNT_TAG, stripMoney } from "./money";

// ---------- the transcriber's vocabulary hint ----------

// Built on the server from that one job only: who's on it, the machines on the board, the site, the activity-code
// names. Names only - nothing that looks like a number with a $ survives, and nothing else is ever passed in.
export type VocabularyInput = { site: string; crew: string[]; plant: string[]; codes: string[] };
export const VOCAB_MAX = 1500;
// A name with any amount taken out (and the brackets / dash it sat in), at most 60 characters. The transcriber's hint
// and Claude both get names cleaned this way (SEC-004) - crew, plant, site, codes.
export const NAME_MAX = 60;
export const cleanName = (s: string) => nameWithoutAmounts(s).slice(0, NAME_MAX);
export type CleanContextInput = {
  site: string; crew: string[]; plant: string[];
  // fill-everything: the job's machines in board order (numbered for Claude - never an id), the crew's signed hours
  plantList?: string[]; crewHours?: { name: string; hours: number }[]; signedHours?: number;
};
export const cleanContext = (c: CleanContextInput): CleanContextInput => {
  const uniq = (xs: string[]) => [...new Set(xs.map(cleanName).filter((x) => x.length > 1))];
  return {
    site: cleanName(c.site), crew: uniq(c.crew), plant: uniq(c.plant),
    ...(c.plantList ? { plantList: c.plantList.map((n, i) => cleanName(n) || `Machine ${i + 1}`) } : {}),
    ...(c.crewHours ? { crewHours: c.crewHours.map((p) => ({ name: cleanName(p.name) || "Crew member", hours: p.hours })) } : {}),
    ...(c.signedHours != null ? { signedHours: c.signedHours } : {}),
  };
};
export function buildVocabulary(v: VocabularyInput): string {
  const clean = cleanName;
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
export type Cleaned = { sections: CleanedSection[]; delays: SuggestedDelay[]; checkThis: string[]; amountsRemoved: boolean; fill: Fill };

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
    ...FILL_SCHEMA_PROPS, // fill-everything (29 Oct 2026): activity hours, plant hours, tip runs
  },
  required: ["sections", "delays", "checkThis", "activity", "plant", "tipRuns"], additionalProperties: false,
} as const;

const textOf = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
// Plain code decides what is kept: known headings only (in the standard order, one each), known delay codes only,
// hours between 0 and 24 or null, text capped, every dollar amount taken out again. Anything else is dropped.
// With a fill context (fill-everything) it also keeps the suggested activity hours, plant hours and tip runs that are
// valid for this job, and says in "Check this" what doesn't add up (./fill.ts).
export function validateCleaned(raw: unknown, transcriptHadAmounts = false, fillCtx?: FillContext): Cleaned {
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
    byHeading.set(heading, fit(noMoney(byHeading.has(heading) ? `${byHeading.get(heading)} ${text}` : text), SECTION_MAX));
  }
  // The whole cleaned note within NOTE_MAX (heading labels and line breaks included), with a little room for the
  // money check after the join (cleanedNote).
  let room = NOTE_MAX - 400;
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
  const { fill, checks } = fillCtx ? validateFill(r, fillCtx, noMoney) : { fill: NO_FILL, checks: [] };
  return { sections, delays, checkThis: [...checks, ...checkThis].slice(0, 12), amountsRemoved: removed, fill };
}

// The cleaned text as one note (what goes in the log's note box for the supervisor to edit). validateCleaned keeps it
// within NOTE_MAX, so it's never cut when the log is sent.
export const cleanedNote = (c: Cleaned) => stripMoney(c.sections.map((s) => `${s.heading}: ${s.text}`).join("\n")).text;

// At most 9000 characters of transcript go to Claude - 5 minutes of fast talk (SEC-005). Beyond that the end is
// left off and "Check this" says so.
export const TRANSCRIPT_MAX = 9000;
export const LONG_RECORDING = "The recording was long, so the end may be missing - check it and type anything that's missing.";
export const capTranscript = (t: string) => (t.length <= TRANSCRIPT_MAX ? { text: t, cut: false, notice: LONG_RECORDING } : { text: t.slice(0, TRANSCRIPT_MAX), cut: true, notice: LONG_RECORDING });
export const FAILED_TO_TEXT = "Couldn't turn that into text - try again or type it.";

// Recordings add up (29 Oct 2026): a recording's text goes under the note so far - nothing there, just the text;
// otherwise a dashed line with the time first. The screen refuses (and says so) if that would pass NOTE_MAX.
export const addToNote = (note: string, text: string, at: Date) => {
  if (!note.trim()) return text;
  const time = at.toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
  return `${note.trimEnd()}\n\n----- ${time} -----\n${text}`;
};
