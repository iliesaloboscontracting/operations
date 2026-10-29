// Taking dollar amounts out of free text on the daily log (29 Oct 2026) - spoken (voice entry) or typed (the note, the
// crew note, delay notes, docket fields: security review SEC-002). Each amount becomes "(amount not recorded)" - the
// text is never refused, so nobody loses what they wrote - and the screen says "Amounts aren't recorded here - tell
// the office". `linkSafe` / `assertNoMoney` stay the backstop. No imports but the money guard, so the log rules and
// the voice rules can both use it. `npm test` (voice.test.ts).
import { assertNoMoney } from "../moneyGuard";

export const AMOUNTS_NOTICE = "Amounts aren't recorded here - tell the office.";
export const AMOUNT_TAG = "(amount not recorded)";
const NUMBER_WORDS = "a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and|half";
// Words for money: a currency after the number, or slang (SEC-006: AUD / USD / EUR / quid / pounds / euros too).
const CURRENCY = String.raw`(?:dollars?|bucks|cents?|grand|aud|usd|eur|euros?|quid|pounds?)`;
// A rate after an amount goes with it: "$80 an hour", "$850/day", "45 dollars per tonne".
const RATE = String.raw`(?:\s?(?:\/|per\b|an?\b|each\b)\s?(?:h|hr|hrs|hour|day|week|wk|month|t|tonne|ton|m3|load|bin|man|person)s?\b)?`;
// Words that make a bare "1.2k" money: "paid 1.2k", "1.2k invoice" (SEC-006).
const MONEY_WORD = String.raw`(?:cost|costs|costing|paid|pay|paying|charged?|charging|price|priced|quote[ds]?|quoting|invoice[ds]?|fee|fees|bill|billed|spent|spend)`;
const MONEY_PATTERNS = [
  // $500, $ 1,250.50, A$300, US$40, $2k, $1.5 million (+ a rate)
  new RegExp(String.raw`(?:\b(?:AUD|USD|US|A)\s?)?\$\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?(?:k|m|million|thousand|grand)\b)?` + RATE, "gi"),
  // AUD 80, USD 40, EUR 30 (currency first)
  new RegExp(String.raw`\b(?:AUD|USD|EUR)\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?k)?\b` + RATE, "gi"),
  // 500 dollars, 2.5k bucks, 30 cents, 80 AUD, 50 quid, 20 euros (+ a rate)
  new RegExp(String.raw`\b\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:k\s?)?` + CURRENCY + String.raw`\b` + RATE, "gi"),
  // a 500-dollar fine, a five-hundred-dollar bill
  new RegExp(String.raw`\b(?:\d(?:[\d,]*\d)?(?:\.\d+)?|(?:(?:${NUMBER_WORDS})-?)+)-dollar\b`, "gi"),
  // five hundred dollars, a couple of grand, twenty bucks (+ a rate)
  new RegExp(String.raw`\b(?:(?:${NUMBER_WORDS}|couple(?: of)?|few)[\s-]+)+` + CURRENCY + String.raw`\b` + RATE, "gi"),
  // paid 1.2k, quote of 3k, 1.2k invoice
  new RegExp(String.raw`\b` + MONEY_WORD + String.raw`\s+(?:of\s+|was\s+|is\s+|about\s+|around\s+|us\s+)?\d(?:[\d,]*\d)?(?:\.\d+)?\s?k\b`, "gi"),
  new RegExp(String.raw`\b\d(?:[\d,]*\d)?(?:\.\d+)?\s?k\s+(?:for\s+(?:the\s+)?)?` + MONEY_WORD + String.raw`\b`, "gi"),
];
// A name (a hire worker's name or company, a machine, a site) with any amount taken out and no tag left behind - so a
// "$5 Labour" company can't break the log screen or the report (SEC-010).
export const nameWithoutAmounts = (s: string) =>
  stripMoney(s).text.replace(/\(amount not recorded\)/g, "").replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+[-–]\s*$/, "").replace(/\s+/g, " ").trim();

// Every dollar amount out of a piece of text. `removed` says whether there was one (the screen then shows AMOUNTS_NOTICE).
export function stripMoney(text: string): { text: string; removed: boolean } {
  let out = text, removed = false;
  for (const re of MONEY_PATTERNS) out = out.replace(re, () => { removed = true; return AMOUNT_TAG; });
  // Anything the guard would still flag (a "$" followed by a digit in some other shape, even across a line break) goes too.
  if (!assertNoMoney(out)) { out = out.replace(/\$\s?\d(?:[\d.,]*\d)?/g, AMOUNT_TAG); removed = true; }
  return { text: out, removed };
}
