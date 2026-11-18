// SEC-002 (27 Oct 2026): one real person with more than one login. Code only, on purpose - nobody can add a pair from
// inside the app. Used by maker-checker (a person can't approve their own request under another login) and by the
// duplicate-name rule on the Users page. No server imports.
//
// Each pair is two User ids belonging to the same person.
export const SAME_PERSON: [string, string][] = [
  // Nick Giannopoulos: his ADMIN (operations) login and his DIRECTOR login.
  ["cmvnh13p80001c8w58nolsvnj", "cmvko5k240001se8qoimhzk4w"],
  // Iliesa: the owner login and the Building Agent login (PUR-001, 27 Oct 2026) - neither approves the other's
  // purchase or change requests.
  ["cmubx963700004t2nskaa059p", "cmv81x7om0000cfw714gqtmz2"],
];

// The same login, or two logins listed above as one person.
export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return SAME_PERSON.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// Names compared without case, extra spaces, punctuation or look-alike characters (IND-002, 18 Nov 2026: "Iliesa
// Tubakibau Weldon!" or the name with an invisible character must count as the SAME name, so another login can't take it).
export const normName = (s: string | null | undefined) =>
  (s ?? "").normalize("NFKC").replace(/[\p{Cf}\p{Cc}]/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// IND-002: what a login's name may contain - letters, numbers, spaces, apostrophes, hyphens and full stops, as typed
// (no invisible or look-alike characters). Estimating and the Tenders board tell people apart by this name.
export function userNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2 || name.length > 80) return "A name needs 2 to 80 characters.";
  if (name.normalize("NFKC") !== name || /[\p{Cf}\p{Cc}\p{Co}\p{Cn}]/u.test(name) || !/^[\p{Script=Latin}\p{M}0-9 .'-]+$/u.test(name) /* Latin letters only: no look-alike Cyrillic / Greek letters */ || /\s{2,}/.test(name)) {
    return "Names can only have letters, numbers, single spaces, apostrophes, hyphens and full stops.";
  }
  return null;
}
