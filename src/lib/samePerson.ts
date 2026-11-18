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

// IND-002 / IND-014 (Ilies approved 18 Nov 2026): what a login's name may contain - plain letters A-Z, numbers, single
// spaces, apostrophes, hyphens and full stops. Exactly the set Lobos Estimating accepts (it refuses anything else), so
// nothing it would drop or change - an accent, an invisible or look-alike character - can make a name pass as someone
// else's there. Estimating and the Tenders board tell quote issuers apart by this name (and by login email).
export const PLAIN_NAME = /^[A-Za-z0-9 .'-]{2,80}$/;
export function userNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2 || name.length > 80) return "A name needs 2 to 80 characters.";
  if (!PLAIN_NAME.test(name) || / {2,}/.test(name)) {
    return "Names can only have plain letters (A-Z, no accents), numbers, single spaces, apostrophes, hyphens and full stops.";
  }
  // IND-020 (18 Nov 2026): a real name has a letter in it; "local" is the name Estimating uses when no one is signed in.
  if (!/[A-Za-z]/.test(name)) return "A name needs at least one letter.";
  if (name.toLowerCase() === "local") return "That name is reserved - use the person's name.";
  return null;
}
// IND-016 / IND-018 (Ilies approved 18 Nov 2026): login emails in plain characters only - exactly Lobos Estimating's
// rule (no apostrophe, at most 120 characters), so every login can use Estimating.
export const plainEmail = (email: string) => email.length <= 120 && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email);
// IND-015: a login listed above as one of a person's two logins.
export const isPairedLogin = (id: string) => SAME_PERSON.some(([a, b]) => a === id || b === id);
