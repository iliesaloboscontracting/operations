import { prisma } from "./prisma";
import { addDays, daysBetween } from "./dates";
import { StartAlertDTO, ShiftType } from "./types";

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

// Projects that start within `windowDays` of `today`, with a readiness check for the start day.
//
// Only projects with an explicit startDate (set on the Projects page) can raise an alert.
// A project is cleared - left out of the result entirely - once it no longer needs a look:
// either a Supervisor or Lead has been allocated on the start day (Ilies, 16 Oct 2026: that
// is what clears the notification - plant/vehicles are only listed while it's still up),
// or every job on the start day has been stood down / made inactive on purpose.
export async function upcomingStarts(
  today: string,
  windowDays = 7
): Promise<StartAlertDTO[]> {
  const projects = await prisma.project.findMany({
    where: { archived: false, status: "ACTIVE" },
    include: {
      jobs: {
        select: {
          date: true,
          shift: true,
          notRunning: true,
          assignments: {
            select: {
              role: true,
              resource: { select: { type: true, category: true } },
            },
          },
        },
      },
    },
  });

  const limit = addDays(today, windowDays);
  const out: StartAlertDTO[] = [];

  for (const p of projects) {
    const jobs = p.jobs.map((j) => ({ ...j, iso: isoOf(j.date) }));
    const start = p.startDate;
    if (!start || start < today || start > limit) continue;

    const onStartAll = jobs.filter((j) => j.iso === start);

    // Nothing was ever entered for the start day at all - still worth a heads-up.
    if (onStartAll.length === 0) {
      const daysAway = daysBetween(today, start);
      out.push({
        projectId: p.id,
        name: p.name,
        jobNo: p.jobNo,
        startDate: start,
        daysAway,
        shifts: [],
        crew: 0,
        plant: 0,
        hasSupervisor: false,
        issues: ["Nothing scheduled on the start day"],
        level: daysAway <= 2 ? "critical" : "warn",
        noJobYet: true,
      });
      continue;
    }

    // Every job on the start day was deliberately stood down / made inactive - nothing to flag.
    const onStart = onStartAll.filter((j) => !j.notRunning);
    if (onStart.length === 0) continue;

    let crew = 0;
    let plant = 0;
    let hasSupervisor = false;
    for (const j of onStart)
      for (const a of j.assignments) {
        const t = a.resource.type;
        if (t === "PERSONNEL" || (t === "HIRE" && a.resource.category === "LABOUR")) {
          crew++;
          if (a.role === "Supervisor" || a.role === "Lead") hasSupervisor = true;
        } else if (t === "EQUIPMENT" || t === "ATTACHMENT" || t === "VEHICLE") {
          plant++;
        }
      }

    // Someone is in charge on the start day - clear it.
    if (hasSupervisor) continue;

    const issues: string[] = [];
    if (crew === 0) issues.push("No crew assigned");
    else issues.push("No supervisor");
    if (plant === 0) issues.push("No plant or vehicles assigned");

    const daysAway = daysBetween(today, start);
    out.push({
      projectId: p.id,
      name: p.name,
      jobNo: p.jobNo,
      startDate: start,
      daysAway,
      shifts: Array.from(new Set(onStart.map((j) => j.shift as ShiftType))),
      crew,
      plant,
      hasSupervisor,
      issues,
      level: daysAway <= 2 ? "critical" : "warn",
      noJobYet: false,
    });
  }

  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));
}
