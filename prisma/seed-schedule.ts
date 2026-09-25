import { PrismaClient } from "@prisma/client";

// Adds a forward schedule so the Calendar and "starting within a week" alerts have data:
//  - copies today's running jobs onto the next 14 weekdays (staffed for the first 5, drafts after)
//  - gives Mosman and Woollahra future start dates with a couple of days each
// Additive and idempotent: it does nothing if future jobs already exist. Does NOT wipe data.

const iso = (d: Date) => d.toISOString().slice(0, 10);

function dayOffset(n: number) {
  const t = new Date();
  return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate() + n));
}

export async function seedSchedule(prisma: PrismaClient) {
  const today = dayOffset(0);
  // Days that already have jobs (e.g. from "Copy yesterday") are left untouched.
  const busy = new Set(
    (await prisma.job.findMany({ where: { date: { gt: today } }, select: { date: true } })).map(
      (j) => iso(j.date)
    )
  );
  const hasJobs = (d: Date) => busy.has(iso(d));

  // ---- copy today's board forward on weekdays ----
  const source = await prisma.job.findMany({
    where: { date: today, notRunning: false },
    include: { assignments: true },
  });
  let staffedDays = 0;
  for (let n = 1; n <= 21 && staffedDays < 14; n++) {
    const date = dayOffset(n);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    staffedDays++;
    if (hasJobs(date)) continue;
    for (const j of source) {
      await prisma.job.create({
        data: {
          projectId: j.projectId,
          title: j.title,
          siteCode: j.siteCode,
          date,
          shift: j.shift,
          startTime: j.startTime,
          endTime: j.endTime,
          dayBrief: j.dayBrief,
          colorTag: j.colorTag,
          sortOrder: j.sortOrder,
          assignments:
            staffedDays <= 5
              ? { create: j.assignments.map((a) => ({ resourceId: a.resourceId, role: a.role })) }
              : undefined,
        },
      });
    }
  }

  // ---- projects with future start dates ----
  const person = (name: string) => prisma.resource.findFirst({ where: { name } });

  const mosman = await prisma.project.findFirst({ where: { name: { startsWith: "Mosman" } } });
  if (mosman) {
    const start = dayOffset(2);
    await prisma.project.update({ where: { id: mosman.id }, data: { startDate: iso(start) } });
    const cem = await person("Daniel");
    for (let k = 0; k < 3; k++) {
      const date = dayOffset(2 + k);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      await prisma.job.create({
        data: {
          projectId: mosman.id,
          title: mosman.name,
          siteCode: mosman.jobNo,
          date,
          shift: "DAY",
          startTime: mosman.dayStart,
          endTime: mosman.dayEnd,
          dayBrief: "Site set-up and demolition access",
          colorTag: "orange",
          sortOrder: 20,
          // Deliberately thin: one labourer, no supervisor, no plant -> shows as an alert
          assignments: cem ? { create: [{ resourceId: cem.id, role: "General labour" }] } : undefined,
        },
      });
    }
  }

  const wool = await prisma.project.findFirst({ where: { name: { startsWith: "Woollahra" } } });
  if (wool) {
    const start = dayOffset(6);
    await prisma.project.update({ where: { id: wool.id }, data: { startDate: iso(start) } });
    for (let k = 0; k < 4; k++) {
      const date = dayOffset(6 + k);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      await prisma.job.create({
        data: {
          projectId: wool.id,
          title: wool.name,
          siteCode: wool.jobNo,
          date,
          shift: "DAY",
          startTime: wool.dayStart,
          endTime: wool.dayEnd,
          dayBrief: "Mobilise and take site handover",
          colorTag: "orange",
          sortOrder: 21,
        },
      });
    }
  }

  // A ready-to-go start, so you can see what "all good" looks like
  const gym = await prisma.project.findFirst({ where: { name: { startsWith: "Gym demolition" } } });
  if (gym) {
    let off = 3; // first weekday from +3 days
    while ([0, 6].includes(dayOffset(off).getUTCDay())) off++;
    const date = dayOffset(off);
    await prisma.project.update({
      where: { id: gym.id },
      data: { status: "ACTIVE", startDate: iso(date) },
    });
    const sup = await person("Pol");
    const lab = await person("Emil");
    const ex = await person("8t Excavator");
    if (sup && lab && ex) {
      await prisma.job.create({
        data: {
          projectId: gym.id,
          title: gym.name,
          siteCode: gym.jobNo,
          date,
          shift: "DAY",
          startTime: gym.dayStart,
          endTime: gym.dayEnd,
          dayBrief: "Strip-out and bin placement",
          colorTag: "blue",
          sortOrder: 22,
          assignments: {
            create: [
              { resourceId: sup.id, role: "Supervisor" },
              { resourceId: lab.id, role: "General labour" },
              { resourceId: ex.id, role: "Plant" },
            ],
          },
        },
      });
    }
  }

  console.log("Schedule seed complete.");
}

// Allow `npm run db:seed-schedule` to run it standalone.
if (require.main === module) {
  const prisma = new PrismaClient();
  seedSchedule(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
