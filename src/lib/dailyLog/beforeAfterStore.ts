// Before and after photos - reading them for the link, Day Review, the daily site report and the reminder (30 Oct
// 2026). Only shown (not removed) photos; names and times only, never a file name or anything to do with money.
// Writing them from a link is beforeAfterLink.ts.
import { prisma } from "../prisma";
import { sydneyTime } from "../signin";
import { nameWithoutAmounts } from "./money";
import { photoFlags, type Phase } from "./beforeAfter";
import type { BeforeAfterDTO, BeforeAfterPhotoDTO } from "./types";

export type BeforeAfterSets = { before: BeforeAfterPhotoDTO[]; after: BeforeAfterPhotoDTO[] };
const EMPTY: BeforeAfterSets = { before: [], after: [] };

// The shown photos of each job, oldest first, by phase.
export async function beforeAfterFor(jobIds: string[]): Promise<Map<string, BeforeAfterSets>> {
  const out = new Map<string, BeforeAfterSets>();
  if (!jobIds.length) return out;
  const rows = await prisma.siteLogPhoto.findMany({
    where: { jobId: { in: jobIds }, hiddenAt: null }, orderBy: { createdAt: "asc" },
    select: { id: true, jobId: true, phase: true, takenBy: true, createdAt: true },
  });
  for (const r of rows) {
    const sets = out.get(r.jobId) ?? { before: [], after: [] };
    const p: BeforeAfterPhotoDTO = { id: r.id, at: r.createdAt.toISOString(), atLabel: sydneyTime(r.createdAt) ?? "", takenBy: nameWithoutAmounts(r.takenBy) };
    (r.phase === "BEFORE" ? sets.before : sets.after).push(p);
    out.set(r.jobId, sets);
  }
  return out;
}

export function beforeAfterDTO(sets: BeforeAfterSets | undefined, f: { ran: boolean; hasLog: boolean; pastDue: boolean }): BeforeAfterDTO {
  const s = sets ?? EMPTY;
  return { before: s.before, after: s.after, ...photoFlags({ ...f, before: s.before.length, after: s.after.length }) };
}

// A shown photo's file, only when it belongs to that job (the office's and the directors' photo routes).
export async function beforeAfterFile(jobId: string, id: string): Promise<string | null> {
  if (!jobId || !id) return null;
  const r = await prisma.siteLogPhoto.findUnique({ where: { id }, select: { jobId: true, fileName: true, hiddenAt: true } });
  return r && r.jobId === jobId && !r.hiddenAt ? r.fileName : null;
}

export async function setCounts(jobId: string, phase: Phase) {
  const [shown, rows] = await Promise.all([
    prisma.siteLogPhoto.count({ where: { jobId, phase, hiddenAt: null } }),
    prisma.siteLogPhoto.count({ where: { jobId, phase } }),
  ]);
  return { shown, rows };
}
