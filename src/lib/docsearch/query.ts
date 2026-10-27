// LCI phase 6: what a person types -> a safe FTS5 query. Every word is quoted (so nothing they type is FTS syntax:
// no NEAR, column filters or operators), all words are required, and the last one is a prefix match. No server
// imports; `npm test` (docsearch.test.ts).
export function toFtsQuery(input: string): string | null {
  const words = (input.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [])
    .map((w) => w.replace(/["]/g, "").replace(/[’']/g, "").slice(0, 40))
    .filter((w) => w.length >= 2 || /\d/.test(w))
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 && w.length >= 3 ? "*" : ""}`).join(" AND ");
}

// Snippet markers from the index (control characters never found in document text) -> parts for the page to render
// as text (never as HTML).
export const MARK_OPEN = "\u0001", MARK_CLOSE = "\u0002";
export function snippetParts(s: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  for (const piece of s.split(MARK_OPEN)) {
    const [hit, rest] = piece.includes(MARK_CLOSE) ? piece.split(MARK_CLOSE, 2) : [null, piece];
    if (hit !== null && hit !== "") out.push({ text: hit, hit: true });
    if (rest) out.push({ text: rest, hit: false });
  }
  return out;
}
