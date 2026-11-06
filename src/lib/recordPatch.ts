// Changing a resource or a project record (LCI phase 4, step 4a, 25 Oct
// 2026): the "check, then update" bodies of PATCH /api/resources/:id and
// PATCH /api/projects/:id, moved here unchanged so the edit screens and the
// approved-change executor (phase 4, docs/lci/PHASE4-5-DESIGN.md §1.5) run one
// set of rules. The routes keep their guards and responses exactly as before.
import type { Project, Resource } from "@prisma/client";
import { prisma } from "./prisma";
import { pickResourceData, PAY_RATE_FIELDS } from "./resourceFields";
import { hireRegisterError } from "./hireServer";
import { hireDateError } from "./dateRules";
import { formOffHireDay, hireStatusChangeError, offHiresByStatus } from "./offHire/rules";
import { closeOffHireRequests, recordOffHire } from "./offHire/store";
import { todaySydney } from "./today";
import { pickProject } from "./pickProject";
import { projectFileError } from "./projectFileServer";

export type PatchProblem = { error: string; status: number };

// The fields a body may change (pickResourceData), pay rates for an Admin
// only, the hire dates and the hire register's own rules. A record that
// doesn't exist throws from Prisma, as the route always has.
export async function applyResourcePatch(id: string, body: Record<string, unknown>, actor: { role: string | null; name?: string | null }): Promise<{ resource: Resource } | PatchProblem> {
  if (PAY_RATE_FIELDS.some((f) => f in body)) {
    if (actor.role !== "ADMIN") {
      return { error: "Only an admin can change pay rate details", status: 403 };
    }
  }

  const data = pickResourceData(body) as Record<string, unknown>;
  if ("onHireDate" in data || "offHireDate" in data) {
    const existing = await prisma.resource.findUnique({
      where: { id },
      select: { onHireDate: true, offHireDate: true },
    });
    const hireError = hireDateError({ ...(existing ?? {}), ...data } as Parameters<typeof hireDateError>[0]);
    if (hireError) return { error: hireError, status: 400 };
  }
  const registerError = await hireRegisterError(data);
  if (registerError) return { error: registerError, status: 400 };
  // Off-hire (5 Nov 2026): set to Off-hired from the Status box records the day (as the Off-hired button
  // does) and closes its off-hire request; once off-hired, only "Put back on hire" undoes it.
  let offHiredDay: string | null = null;
  if ("hireStatus" in data) {
    const existing = await prisma.resource.findUnique({ where: { id }, select: { type: true, category: true, active: true, hireStatus: true, offHiredOn: true, onHireDate: true, offHireDate: true } });
    const statusError = hireStatusChangeError(existing, data.hireStatus);
    if (statusError) return { error: statusError, status: 400 };
    const next = { type: String(data.type ?? existing?.type ?? ""), category: (data.category ?? existing?.category ?? null) as string | null };
    if (existing?.active && offHiresByStatus(existing, data.hireStatus, next)) {
      offHiredDay = formOffHireDay({ ...existing, ...data } as Parameters<typeof formOffHireDay>[0], todaySydney());
      Object.assign(data, { offHiredOn: offHiredDay, offHiredBy: actor.name ?? null, offHiredAt: new Date() });
    }
  }

  if (offHiredDay) {
    // N1: only if nobody off-hired it a moment ago (the button), and its history row in the same go.
    const day = offHiredDay;
    const by = actor.name ?? "Operations";
    const resource = await prisma.$transaction(async (tx) => {
      const n = await tx.resource.updateMany({ where: { id, offHiredOn: null }, data: data as any });
      if (!n.count) return null;
      const row = await tx.resource.findUniqueOrThrow({ where: { id } });
      await recordOffHire(tx, id, { action: "OFF_HIRED", day, ref: row.offHireRef, via: "STATUS_BOX", by });
      return row;
    });
    if (!resource) return { error: "Someone has just off-hired it - close this window and reopen it to see when.", status: 409 };
    await closeOffHireRequests(id, day, resource.offHireRef, by);
    return { resource };
  }

  const resource = await prisma.resource.update({
    where: { id },
    data: data as any,
  });
  return { resource };
}

// The fields a body may change (pickProject) and the Project File rules
// (dates, no dollar figures in crew-facing text, the office contact).
export async function applyProjectPatch(id: string, body: Record<string, unknown>): Promise<{ project: Project } | PatchProblem> {
  const data = pickProject(body);
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { startDate: true, expectedCompletion: true, completionReviewBy: true },
  });
  if (!existing) return { error: "That project doesn't exist anymore.", status: 404 };
  const invalid = await projectFileError(data, existing);
  if (invalid) return invalid;
  const project = await prisma.project.update({
    where: { id },
    data: data as any,
  });
  return { project };
}
