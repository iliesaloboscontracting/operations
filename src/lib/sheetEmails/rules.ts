// The allocation email list (Ilies, 20 Nov 2026: "add these emails to the automatic email listing when allocations
// goes out into outlook"; answers: the addresses go in To, and everyone on the list gets it every day). Plain rules
// only - no database here: reading a pasted block of addresses, and building the "Open in email" link.
//
// The addresses are workers' personal emails. They live in the database (SheetEmailRecipient) and nowhere else: never
// in code, git, tests (made-up example.com addresses only), seed files, logs, a site link or a DaySheetSend snapshot.

export const MAX_SHEET_EMAILS = 100; // active addresses on the list
export const MAX_PASTE_CHARS = 20_000;
export const MAX_PASTE_ENTRIES = 300;
const MAX_EMAIL = 254;
const MAX_LABEL = 80;

// The longest mailto: link "Open in email" will hand to Windows (20 Nov 2026). Nothing in the chain promises more:
// Chrome refused external links over 2,048 characters for years (crbug.com/727909), Outlook 2010 was measured cutting
// mailto links at about 2,061, IE stopped at 2,083, and Microsoft documents no mailto limit for Outlook classic or the
// new Outlook for Windows. Past the limit the failure is silent - nothing opens, or the body is cut off - so above
// it the email opens with the To list and subject only, and the sheet is copied for pasting (never cut short).
export const MAILTO_SAFE_LENGTH = 2000;

// A plain, strict address: letters, digits and . _ + ' - before the @ (no dot first, last or doubled); a domain of
// dot-separated labels (letters, digits, inner hyphens) ending in a 2-24 letter top level. Lower case only - callers
// lower-case first.
const LOCAL = /^[a-z0-9_+'-]+(\.[a-z0-9_+'-]+)*$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function isValidEmail(email: string): boolean {
  if (typeof email !== "string" || email.length > MAX_EMAIL || email !== email.toLowerCase()) return false;
  const at = email.lastIndexOf("@");
  if (at < 1 || email.indexOf("@") !== at) return false;
  const local = email.slice(0, at), domain = email.slice(at + 1);
  return local.length <= 64 && LOCAL.test(local) && DOMAIN.test(domain);
}

// Invisible / control characters out (a newline stays - it separates addresses), then trimmed.
const clean = (s: string) =>
  s.replace(/[\r\n]+/g, "\n").replace(/\t/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : "")).trim();

export function tidyLabel(raw: string | null | undefined): string | null {
  const s = clean(raw ?? "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").slice(0, MAX_LABEL).trim();
  return s && !s.includes("@") ? s : null;
}

// Why an address came off the list - optional, one line, 300 characters at most.
export function tidyReason(raw: unknown): string | null {
  const s = typeof raw === "string" ? clean(raw).replace(/\s+/g, " ").slice(0, 300).trim() : "";
  return s || null;
}

export type ParsedEmail ={ email: string; label: string | null };
export type ParsedBlock = {
  entries: ParsedEmail[]; // valid, lower-cased, each address once (the first one pasted wins), in the order pasted
  repeated: number; // valid addresses pasted more than once (the extra copies)
  invalid: string[]; // what was pasted for each entry that isn't an address (shortened)
  tooMany: boolean; // more than MAX_PASTE_ENTRIES entries, or more than MAX_PASTE_CHARS characters - nothing read
};

// One address per line, or separated by commas or semicolons. "Joe Bloggs <joe@example.com>" (as Outlook copies
// them) keeps the name as the label; a "Bloggs, Joe <joe@...>" split by its own comma is put back together.
export function parseEmailBlock(text: unknown): ParsedBlock {
  const out: ParsedBlock = { entries: [], repeated: 0, invalid: [], tooMany: false };
  if (typeof text !== "string") return out;
  if (text.length > MAX_PASTE_CHARS) return { ...out, tooMany: true };
  const pieces = clean(text).split(/[\n;,]/).map((p) => p.trim()).filter(Boolean);
  const merged: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i], next = pieces[i + 1];
    if (!p.includes("@") && !p.includes("<") && next && /^[^@<>]*<[^<>]*@[^<>]*>$/.test(next) && !next.startsWith("<")) {
      merged.push(`${p}, ${next}`);
      i++;
    } else merged.push(p);
  }
  if (merged.length > MAX_PASTE_ENTRIES) return { ...out, tooMany: true };
  const seen = new Set<string>();
  for (const piece of merged) {
    const named = /^(.*?)<([^<>]*)>$/.exec(piece);
    let label = named ? tidyLabel(named[1]) : null;
    let email = (named ? named[2] : piece).trim().replace(/^mailto:/i, "").toLowerCase();
    // A name and an address side by side ("Joe Bloggs joe@example.com", or two spreadsheet columns): exactly one
    // word holds an @ and it is a valid address - that's the address, the rest is the name.
    if (!named && /\s/.test(email)) {
      const words = piece.split(/\s+/);
      const withAt = words.filter((w) => w.includes("@"));
      if (withAt.length === 1 && isValidEmail(withAt[0].replace(/^mailto:/i, "").toLowerCase())) {
        email = withAt[0].replace(/^mailto:/i, "").toLowerCase();
        label = tidyLabel(words.filter((w) => w !== withAt[0]).join(" "));
      }
    }
    if (!isValidEmail(email)) {
      out.invalid.push(piece.length > 60 ? `${piece.slice(0, 57)}...` : piece);
      continue;
    }
    if (seen.has(email)) { out.repeated++; continue; }
    seen.add(email);
    out.entries.push({ email, label });
  }
  return out;
}

// What adding a pasted block does to the list: the new addresses, how many were already on it (or pasted twice), and
// whether the list would go over its cap (then nothing is added - it holds MAX_SHEET_EMAILS).
export function planAdd(active: Iterable<string>, parsed: ParsedBlock) {
  const on = new Set(active);
  const toAdd = parsed.entries.filter((e) => !on.has(e.email));
  const already = parsed.entries.length - toAdd.length + parsed.repeated;
  const total = on.size + toAdd.length;
  return { toAdd, already, total, overCap: total > MAX_SHEET_EMAILS };
}

// "Added 3, already on the list 1, not valid: bob@, x"
export function addSummary(r: { added: number; already: number; invalid: string[] }) {
  const parts = [`Added ${r.added}`, `already on the list ${r.already}`];
  if (r.invalid.length) parts.push(`not valid: ${r.invalid.join(", ")}`);
  return parts.join(", ");
}

// One address in a mailto: To - percent-encoded, with the @ left as it is (RFC 6068 allows it, and some mail apps
// split on a literal @). The strict rule above means nothing else in an address needs care.
export const encodeAddress = (email: string) => encodeURIComponent(email).replace(/%40/g, "@");

// For Outlook's To box: semicolons, which classic and the new Outlook both take when pasted.
export const outlookToList = (emails: string[]) => emails.join("; ");

export type MailtoMode =
  | "FULL" // To, subject and the sheet
  | "NO_BODY" // To and subject - the sheet is too long for the link, the user pastes it
  | "NO_RECIPIENTS"; // subject only - even the To list is too long, the user pastes the list, then the sheet

// The "Open in email" link: every address on the list in To (in list order), the subject and sheet exactly as before.
// Never drops some of the addresses or cuts the sheet - whatever doesn't fit is left out whole, and `mode` says so.
export function buildSheetMailto(to: string[], subject: string, body: string, limit = MAILTO_SAFE_LENGTH) {
  const toPart = to.map(encodeAddress).join(",");
  const subj = `subject=${encodeURIComponent(subject)}`;
  const full = `mailto:${toPart}?${subj}&body=${encodeURIComponent(body)}`;
  if (full.length <= limit) return { href: full, mode: "FULL" as MailtoMode, length: full.length };
  const noBody = `mailto:${toPart}?${subj}`;
  if (noBody.length <= limit || !to.length) return { href: noBody, mode: "NO_BODY" as MailtoMode, length: full.length };
  return { href: `mailto:?${subj}`, mode: "NO_RECIPIENTS" as MailtoMode, length: full.length };
}
