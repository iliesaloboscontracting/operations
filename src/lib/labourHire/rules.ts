// Labour hire timesheet (11 Nov 2026, Ilies: "a separate time sheet that's like the current one but just for labour
// hire guys (Advanced Labour Hire) ... exported in the same format ... so I can send the labour hire company the
// precise hours of their guys"). The plain rules - no server imports, so the page, the routes and `npm test` share them.
//
// Hire workers TYPE their company at sign-in, so one company arrives spelt many ways ("Advanced", "Advanced Group",
// "advanced labour hiee", "ALH"). Names are compared by a tidied key:
//   1. lower case, "&" -> "and", every run of punctuation / spaces -> one space;
//   2. filler words dropped (pty, ltd, labour, hire, group ... COMPANY_FILLER) - unless that leaves nothing;
//   3. then the office's own mappings (LabourHireCompanyAlias, e.g. "ALH" -> "Advanced Labour Hire") and the small
//      built-in list below (known misspellings), followed a few steps at most.
// Worker names are tidied the same way (case, spaces, punctuation) within their company - nothing else is guessed
// about a person's name. Hours are never worked out here (lib/dayHours.ts, as for staff). Names and hours only.

export const NO_COMPANY_KEY = "(none)";
export const NO_COMPANY_NAME = "No company given";

// Words that say nothing about which company it is.
export const COMPANY_FILLER = [
  "pty", "ltd", "ptyltd", "pl", "limited", "proprietary", "co", "company", "inc", "the", "and",
  "labour", "labor", "hire", "hiee", "hier", "group", "services", "australia", "aust",
] as const;
const FILLER = new Set<string>(COMPANY_FILLER);

// Known spellings of companies Lobos uses (from the sign-ins so far). key = the company's own key; also = other keys
// that mean it. Anything else is mapped by the office on the page.
export const BUILT_IN_COMPANIES: readonly { key: string; name: string; also: readonly string[] }[] = [
  { key: "advanced", name: "Advanced Labour Hire", also: ["advance", "adcanced", "advanved", "advaced"] },
];

const tidy = (s: string | null | undefined) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// Letters typed one at a time are one word: "A.L.H." -> "alh", "P/L" -> "pl".
const joinInitials = (words: string[]) =>
  words.reduce<string[]>((out, w, i) => (w.length === 1 && i > 0 && words[i - 1].length === 1 ? [...out.slice(0, -1), out[out.length - 1] + w] : [...out, w]), []);

// A typed company name -> its key ("Advanced Labour Hire Pty Ltd" -> "advanced", "ALH" / "A.L.H." -> "alh").
export function companyKey(typed: string | null | undefined): string {
  const words = joinInitials(tidy(typed).split(" ").filter(Boolean));
  if (!words.length) return NO_COMPANY_KEY;
  const kept = words.filter((w) => !FILLER.has(w));
  return (kept.length ? kept : words).join(" ");
}

// A worker's typed name -> its key within a company ("Sam  O'Brien" and "sam obrien" are one person).
export const workerKey = (typed: string | null | undefined) => tidy((typed ?? "").replace(/['’`]/g, "")) || "(no name)";

// The tidied text shown for a typed value: single spaces, trimmed.
export const tidyText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export type CompanyAlias = { alias: string; company: string; retiredAt?: Date | string | null };

// The office's live mappings: alias key -> the company name it means.
export function aliasMap(rows: CompanyAlias[]): Map<string, string> {
  return new Map(rows.filter((r) => !r.retiredAt).map((r) => [r.alias, r.company]));
}

const BUILT_IN_TARGET = new Map(BUILT_IN_COMPANIES.flatMap((c) => c.also.map((a) => [a, c.key] as const)));

// The group a typed company belongs to (its final key). Office mappings first, then the built-in list; at most a few
// steps, and a loop ("A" -> "B" -> "A") stops where it started repeating.
export function resolveCompany(typed: string | null | undefined, aliases: Map<string, string>): string {
  let k = companyKey(typed);
  const seen = new Set<string>();
  for (let i = 0; i < 6 && !seen.has(k); i++) {
    seen.add(k);
    const office = aliases.get(k);
    const next = office != null ? companyKey(office) : BUILT_IN_TARGET.get(k);
    if (next == null || next === k) break;
    k = next;
  }
  return k;
}

// The name shown for a group: the office's mapping to it (the newest first - rows come in that order), else the
// built-in name, else the spelling typed most often (ties: the longer, then A-Z).
export function companyName(key: string, aliasRows: CompanyAlias[], typed: Map<string, number>): string {
  if (key === NO_COMPANY_KEY) return NO_COMPANY_NAME;
  const office = aliasRows.find((r) => !r.retiredAt && companyKey(r.company) === key);
  if (office) return tidyText(office.company);
  const built = BUILT_IN_COMPANIES.find((c) => c.key === key);
  if (built) return built.name;
  return mostCommon(typed) ?? key;
}

export function mostCommon(counts: Map<string, number>): string | null {
  let best: [string, number] | null = null;
  for (const [text, n] of counts) {
    if (!best || n > best[1] || (n === best[1] && (text.length > best[0].length || (text.length === best[0].length && text.localeCompare(best[0]) < 0)))) best = [text, n];
  }
  return best ? best[0] : null;
}

// A company name for a file name: "Advanced Labour Hire" -> "Advanced-Labour-Hire".
export const fileNamePart = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Company";
export const exportFileName = (companyName: string | null, weekStart: string) => `${companyName ? fileNamePart(companyName) : "All-companies"}_week-${weekStart}.csv`;

// ---------- the flags on a line ----------

export type HireFlag = "NO_SIGN_OUT" | "ON_SITE" | "TO_CONFIRM" | "LATE_IN" | "LONG_SHIFT" | "BULK_OUT" | "OVERLAP";
// Not finished: no sign-out yet (or still on site) or waiting for the supervisor - check before sending.
export const UNFINISHED: readonly HireFlag[] = ["NO_SIGN_OUT", "ON_SITE", "TO_CONFIRM"];
// The Sign-ins page's own flags (lib/signinFlags.ts) - information only; they never change hours.
export const INFO: readonly HireFlag[] = ["LATE_IN", "LONG_SHIFT", "BULK_OUT"];

export const isUnfinished = (flags: readonly string[]) => flags.some((f) => (UNFINISHED as readonly string[]).includes(f));
export const isFlaggedInfo = (flags: readonly string[]) => flags.some((f) => (INFO as readonly string[]).includes(f));

// The flags for one line, from what the timesheet already knows about it.
export function lineFlags(l: { out: string | null; onSite?: boolean; status: string; overlap?: boolean }, extra: readonly string[] = []): HireFlag[] {
  return [
    ...(!l.out ? [l.onSite ? "ON_SITE" : "NO_SIGN_OUT"] as HireFlag[] : []),
    ...(l.status === "TO_CONFIRM" ? ["TO_CONFIRM"] as HireFlag[] : []),
    ...(extra.filter((f) => (INFO as readonly string[]).includes(f)) as HireFlag[]),
    ...(l.overlap ? ["OVERLAP"] as HireFlag[] : []),
  ];
}

// "3 lines not finished – check before sending" (null when there are none).
export function bannerText(unfinished: number): string | null {
  return unfinished > 0 ? `${unfinished} line${unfinished === 1 ? "" : "s"} not finished – check before sending` : null;
}
