// Before and after photos - reading them for the link, Day Review, the daily site report and the reminder (30 Oct
// 2026). Shown photos only, except for Managers+ (removed ones too - SEC-BA-004); names and times, never a file name
// or anything to do with money.
// Writing them from a link is beforeAfterLink.ts.
import { prisma } from "../prisma";
import { sydneyTime } from "../signin";
import { nameWithoutAmounts } from "./money";
import { photoFlags, type Phase } from "./beforeAfter";
import type { BeforeAfterDTO, BeforeAfterPhotoDTO, RemovedPhotoDTO } from "./types";

export type BeforeAfterSets = { before: BeforeAfterPhotoDTO[]; after: BeforeAfterPhotoDTO[]; removed?: RemovedPhotoDTO[] };
const EMPTY: BeforeAfterSets = { before: [], after: [] };

// The shown photos of each job, oldest first, by phase. withRemoved (Managers and up only - SEC-BA-004): the removed
// ones too, apart, with who removed them and when.
export async function beforeAfterFor(jobIds: string[], opts: { withRemoved?: boolean } = {}): Promise<Map<string, BeforeAfterSets>> {
  const out = new Map<string, BeforeAfterSets>();
  if (!jobIds.length) return out;
  const rows = await prisma.siteLogPhoto.findMany({
    where: { jobId: { in: jobIds }, ...(opts.withRemoved ? {} : { hiddenAt: null }) }, orderBy: { createdAt: "asc" },
    select: { id: true, jobId: true, phase: true, takenBy: true, createdAt: true, hiddenAt: true, hiddenBy: true },
  });
  for (const r of rows) {
    const sets = out.get(r.jobId) ?? (opts.withRemoved ? { before: [], after: [], removed: [] } : { before: [], after: [] });
    const p: BeforeAfterPhotoDTO = { id: r.id, at: r.createdAt.toISOString(), atLabel: sydneyTime(r.createdAt) ?? "", takenBy: nameWithoutAmounts(r.takenBy) };
    if (r.hiddenAt) sets.removed!.push({ ...p, phase: r.phase === "BEFORE" ? "BEFORE" : "AFTER", removedBy: nameWithoutAmounts(r.hiddenBy ?? ""), removedAtLabel: sydneyTime(r.hiddenAt) ?? "" });
    else (r.phase === "BEFORE" ? sets.before : sets.after).push(p);
    out.set(r.jobId, sets);
  }
  return out;
}

export function beforeAfterDTO(sets: BeforeAfterSets | undefined, f: { ran: boolean; hasLog: boolean; pastDue: boolean }): BeforeAfterDTO {
  const s = sets ?? EMPTY;
  return { before: s.before, after: s.after, ...photoFlags({ ...f, before: s.before.length, after: s.after.length }), ...(s.removed ? { removed: s.removed } : {}) };
}

// A photo's file, only when it belongs to that job (the office's and the directors' photo routes). A removed one only
// with allowRemoved - the office's route, Manager+ (SEC-BA-004); the directors' copy never.
export async function beforeAfterFile(jobId: string, id: string, opts: { allowRemoved?: boolean } = {}): Promise<string | null> {
  if (!jobId || !id) return null;
  const r = await prisma.siteLogPhoto.findUnique({ where: { id }, select: { jobId: true, fileName: true, hiddenAt: true } });
  return r && r.jobId === jobId && (!r.hiddenAt || opts.allowRemoved) ? r.fileName : null;
}

export async function setCounts(jobId: string, phase: Phase) {
  const [shown, rows] = await Promise.all([
    prisma.siteLogPhoto.count({ where: { jobId, phase, hiddenAt: null } }),
    prisma.siteLogPhoto.count({ where: { jobId, phase } }),
  ]);
  return { shown, rows };
}
