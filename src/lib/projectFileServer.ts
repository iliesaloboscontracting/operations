import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { addDays } from "./dates";
import { todaySydney } from "./today";
import { isCompletionValue, isSupervisorRole, moneyError, moneyProblems, MONEY_GUARDED_KEYS } from "./projectFile";
import { OFFICE_ROLE } from "./resource";
import { projectDateError } from "./dateRules";

// Server-side Project File rules (see lib/projectFile.ts for the shared ones).

// Checks a project create/update before it's written: no dollar figures in
// anything that can go out to crew or clients, and the office contact must be
// a Personnel-register entry with the Office role. Returns the problem (message
// and HTTP status), or null when it's fine to save. projectFileError is the
// plain form (also used by applyProjectPatch, lib/recordPatch.ts);
// validateProjectFile wraps it as a response for the routes.
export async function projectFileError(data: Record<string, unknown>, existing?: Record<string, unknown> | null): Promise<{ error: string; status: number } | null> {
  const dateError = projectDateError({ ...(existing ?? {}), ...data } as Parameters<typeof projectDateError>[0]);
  if (dateError) return { error: dateError, status: 400 };

  const problems = moneyProblems(data, MONEY_GUARDED_KEYS);
  if (problems.length) return { error: moneyError(problems), status: 422 };

  if (typeof data.expectedCompletion === "string" && data.expectedCompletion && !isCompletionValue(data.expectedCompletion)) {
    return { error: "Expected completion must be a date or TBC.", status: 400 };
  }

  if (typeof data.officeContactId === "string") {
    const r = await prisma.resource.findUnique({
      where: { id: data.officeContactId },
      select: { type: true, role: true },
    });
    if (!r || r.type !== "PERSONNEL" || r.role !== OFFICE_ROLE) {
      return { error: "The office contact must be someone in the Personnel register with the Office role.", status: 400 };
    }
  }
  return null;
}

export async function validateProjectFile(data: Record<string, unknown>, existing?: Record<string, unknown> | null) {
  const problem = await projectFileError(data, existing);
  return problem ? NextResponse.json({ error: problem.error }, { status: problem.status }) : null;
}

// "Current supervisor" isn't stored on the project - it's whoever is
// allocated as Supervisor or Lead (the day sheet's rule) on the project's
// most recent running job dated today or earlier (Sydney time). Null when
// nobody has been allocated in charge yet.
export async function currentSupervisor(projectId: string) {
  const tomorrow = new Date(addDays(todaySydney(), 1) + "T00:00:00.000Z");
  const job = await prisma.job.findFirst({
    where: {
      projectId,
      notRunning: false,
      date: { lt: tomorrow },
      assignments: { some: { role: { in: ["Supervisor", "Lead"] } } },
    },
    orderBy: { date: "desc" },
    select: {
      date: true,
      shift: true,
      assignments: { select: { role: true, resource: { select: { id: true, name: true, phone: true, type: true } } } },
    },
  });
  if (!job) return null;
  const people = job.assignments
    .filter((a) => isSupervisorRole(a.role) && a.resource.type === "PERSONNEL")
    .map((a) => ({ id: a.resource.id, name: a.resource.name, phone: a.resource.phone, role: a.role }));
  if (!people.length) return null;
  return { date: job.date.toISOString().slice(0, 10), shift: job.shift, people };
}
