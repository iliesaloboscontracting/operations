import { JobDTO, ResourceDTO } from "./types";

// Matches the plain names Claude extracted from a spoken command (see
// api/assistant/parse-command) against the real resource register and the
// jobs currently on the board - deterministic, reviewable string matching,
// not a second LLM call. Never guesses past "ambiguous" or "no match" -
// those get surfaced to the user to resolve by hand rather than assigning
// the wrong person.

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "") // "Aaron (Ezras mate)" -> "Aaron "
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

// Classic edit distance - small names only, so an O(n*m) table is plenty.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export interface PersonMatch {
  spoken: string;
  matches: ResourceDTO[]; // 0 = no match, 1 = confident, 2+ = ambiguous
}

export function matchPeople(spokenNames: string[], resources: ResourceDTO[]): PersonMatch[] {
  const pool = resources
    .filter((r) => r.active)
    .map((r) => ({ resource: r, norm: normalize(r.name) }));

  return spokenNames.map((spoken) => {
    const needle = normalize(spoken);
    if (!needle) return { spoken, matches: [] };

    const exact = pool.filter((p) => p.norm === needle);
    if (exact.length) return { spoken, matches: exact.map((p) => p.resource) };

    // A spoken first name against a full register name - match on the
    // register name's own first token ("Alexander Romanos-Regas" -> "alexander").
    const firstTokenMatch = pool.filter((p) => p.norm.split(" ")[0] === needle);
    if (firstTokenMatch.length) return { spoken, matches: firstTokenMatch.map((p) => p.resource) };

    const startsWith = pool.filter((p) => p.norm.startsWith(needle) || needle.startsWith(p.norm));
    if (startsWith.length) return { spoken, matches: startsWith.map((p) => p.resource) };

    // Last resort: close misspelling of a short name (transcription noise),
    // scaled to the name's length so "sam" doesn't fuzzy-match half the crew.
    const maxDist = needle.length <= 4 ? 1 : 2;
    const close = pool.filter((p) => levenshtein(needle, p.norm.split(" ")[0]) <= maxDist);
    return { spoken, matches: close.map((p) => p.resource) };
  });
}

export interface JobMatch {
  jobs: JobDTO[]; // 0 = no match, 1 = confident, 2+ = ambiguous
}

export function matchJob(spokenJobName: string, boardRows: JobDTO[]): JobMatch {
  const needle = normalize(spokenJobName);
  if (!needle) return { jobs: [] };

  const pool = boardRows.map((j) => ({ job: j, norm: normalize(j.title) }));

  const exact = pool.filter((p) => p.norm === needle);
  if (exact.length) return { jobs: exact.map((p) => p.job) };

  const contains = pool.filter((p) => p.norm.includes(needle) || needle.includes(p.norm));
  if (contains.length) return { jobs: contains.map((p) => p.job) };

  const maxDist = needle.length <= 6 ? 1 : 2;
  const close = pool.filter((p) => levenshtein(needle, p.norm) <= maxDist);
  return { jobs: close.map((p) => p.job) };
}
