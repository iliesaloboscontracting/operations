// "This is how accounts write that site" -> job (SiteAlias). Keep forever (Ilies, 10 Nov 2026): a wording is never
// erased - removing it hides it (removedAt / By / Reason), and saving the same wording again brings that row back
// (the wording is unique). Every change is kept in its history (RecordChange).
import { prisma } from "./prisma";
import { hideTracked, updateTracked, type Who } from "./history/store";

// Saves `text` as meaning `projectId`: a new row, a hidden one brought back, or a live one pointed at this job.
export async function saveSiteAlias(text: string, projectId: string, by: Who, source: string) {
  const existing = await prisma.siteAlias.findUnique({ where: { text } });
  if (!existing) return prisma.siteAlias.create({ data: { text, projectId, createdBy: by?.name ?? null } });
  if (existing.projectId === projectId && !existing.removedAt) return existing;
  return updateTracked("SiteAlias", existing.id, { projectId, removedAt: null, removedBy: null, removeReason: null }, { by, source });
}

export async function removeSiteAlias(projectId: string, text: string, by: Who, reason: string | null) {
  const row = await prisma.siteAlias.findFirst({ where: { projectId, text, removedAt: null }, select: { id: true } });
  if (!row) return null;
  return hideTracked("SiteAlias", row.id, { by, reason, source: "Project page (also called on invoices)" });
}
