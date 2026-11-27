// One active person per name on the Labour register (Ilies, 27 Nov 2026: "Chris.L" was added twice the same day -
// "add the warning"). Two names are the same when they match ignoring case, spaces and punctuation ("Chris.L",
// "chris l" and "CHRIS-L" are one name). A different person with the same name gets a surname or an initial. Plain
// functions - `npm test` (personNames.test.ts); the routes do the database lookup.

export const nameKey = (s: unknown) =>
  typeof s === "string" ? s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") : "";

// The active person already using this name, if any (excluding the record being edited).
export function sameNamePerson<T extends { id: string; name: string }>(name: unknown, people: T[], excludeId?: string | null): T | null {
  const key = nameKey(name);
  if (!key) return null;
  return people.find((p) => p.id !== excludeId && nameKey(p.name) === key) ?? null;
}

export const duplicateNameMessage = (existing: string) =>
  `There's already a ${existing} on the Labour register. Use that one - or, if it's a different person, add a surname or initial so they can be told apart.`;
