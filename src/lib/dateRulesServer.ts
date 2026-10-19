import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { isISODate, jobDateWarnings } from "./dateRules";

// Checks a job date before it's saved (brief 12). A bad date is refused
// outright. Soft warnings (before the project's start, after its planned
// completion, inactive/completed project, weekend) are refused with
// code DATE_WARNING unless the caller sends a reason in `dateCheckNote` -
// the UI then asks the person for one and saves again. Returns an error
// response, or null when it's fine to save.
export async function checkJobDate(
  date: unknown,
  projectId: string | null | undefined,
  dateCheckNote: unknown
): Promise<NextResponse | null> {
  if (!isISODate(date)) {
    return NextResponse.json({ error: "The job date must be a real date (YYYY-MM-DD)." }, { status: 400 });
  }
  const project = projectId
    ? await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, status: true, startDate: true, expectedCompletion: true },
      })
    : null;
  const warnings = jobDateWarnings(date, project);
  if (warnings.length === 0) return null;
  if (typeof dateCheckNote === "string" && dateCheckNote.trim()) return null;
  return NextResponse.json(
    {
      error: `Check the date: ${warnings.join(" ")} Give a reason to save it anyway.`,
      code: "DATE_WARNING",
      warnings,
    },
    { status: 409 }
  );
}
