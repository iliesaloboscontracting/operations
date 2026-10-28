// Searching the job list for the job pickers (accounts, 28 Oct 2026). Every word typed must appear somewhere in the
// job's name, number, client or site address - case doesn't matter, order doesn't matter.
export type JobOption = { id: string; name: string; jobNo?: string | null; client?: string | null; address?: string | null; status?: string };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function jobText(j: JobOption) {
  return norm([j.jobNo, j.name, j.client, j.address].filter(Boolean).join(" "));
}

export function searchJobs<T extends JobOption>(jobs: T[], query: string, limit = 12): T[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return jobs.slice(0, limit);
  const hits: { j: T; rank: number }[] = [];
  for (const j of jobs) {
    const t = jobText(j);
    if (!words.every((w) => t.includes(w))) continue;
    // Exact job number first, then names starting with what was typed, then the rest (list order kept).
    const q = norm(query);
    const rank = norm(j.jobNo) === q ? 0 : norm(j.name).startsWith(q) || norm(j.jobNo).startsWith(q) ? 1 : 2;
    hits.push({ j, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit).map((h) => h.j);
}

export function jobLabel(j: JobOption) {
  return `${j.jobNo ? `${j.jobNo} · ` : ""}${j.name}${j.status && j.status !== "ACTIVE" ? ` (${j.status.toLowerCase()})` : ""}`;
}
