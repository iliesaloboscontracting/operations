import { prisma } from "@/lib/prisma";
import { guardOrCoordinator } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { offHireAlert, offHireMissing } from "@/lib/hireEstimate";
import { todaySydney } from "@/lib/today";

// GET /api/hire-alerts -> hired items coming off hire: overdue (still out past
// the expected finish), finishing today, or within 3 days (21 Oct 2026).
// Since 5 Nov 2026 also `callOff`: items the supervisor said are finished
// (Off-hire requested) that the office hasn't called off yet - they're still
// costing - and `noDate`: items marked off-hired with no off-hire day, whose
// cost can't be worked out until it's filled in.
// Names, suppliers, projects and dates only - no money.
export const GET = withErrorHandling(async () => {
  const denied = await guardOrCoordinator("VIEWER");
  if (denied) return denied;
  const today = todaySydney();
  const items = await prisma.resource.findMany({
    // Status not set counts as still out - a plain NOT would drop those (SQL null).
    where: { type: "HIRE", active: true, OR: [{ hireStatus: null }, { hireStatus: { not: "RETURNED" } }, { offHiredOn: null }] },
    select: {
      id: true, name: true, category: true, agency: true, hireRef: true, hireStatus: true, offHireDate: true, offHiredOn: true, onHireDate: true,
      hireProject: { select: { id: true, name: true } },
    },
  });
  const base = (r: (typeof items)[number]) => ({
    id: r.id, name: r.name, category: r.category, supplier: r.agency, hireRef: r.hireRef, status: r.hireStatus,
    project: r.hireProject?.name ?? null, offHireDate: r.offHireDate, onHireDate: r.onHireDate,
  });
  const order = { OVERDUE: 0, TODAY: 1, SOON: 2 } as const;
  const due = items
    .filter((r) => r.hireStatus !== "OFF_HIRE_REQUESTED")
    .map((r) => ({ r, a: offHireAlert(r, today) }))
    .filter((x): x is { r: (typeof items)[number]; a: NonNullable<ReturnType<typeof offHireAlert>> } => !!x.a);
  // A new finish date already proposed and waiting for approval (16 Nov 2026, Ilies: proposing didn't seem to do
  // anything) - the alert says so instead of offering "Propose new date" again. The date itself only changes once
  // another Admin approves it on Changes.
  const open = due.length
    ? await prisma.changeProposal.findMany({
        where: { kind: "HIRE_OFF_HIRE_DATE", status: "PROPOSED", recordType: "Resource", recordId: { in: due.map((x) => x.r.id) } },
        select: { recordId: true, number: true, after: true },
      })
    : [];
  const proposedFor = (id: string) => {
    const p = open.find((x) => x.recordId === id);
    if (!p) return null;
    let date: string | null = null;
    try {
      const v = JSON.parse(p.after)?.offHireDate;
      date = typeof v === "string" ? v : null;
    } catch { /* unreadable - show the number only */ }
    return { number: p.number, offHireDate: date };
  };
  const alerts = due
    .map(({ r, a }) => ({ ...base(r), level: a.level, daysLeft: a.daysLeft, proposed: proposedFor(r.id) }))
    .sort((x, y) => order[x.level] - order[y.level] || x.daysLeft - y.daysLeft);

  // When the supervisor said "Finished" (the latest such hire check), if they did.
  const gear = items.filter((r) => r.category !== "LABOUR"); // labour hire is costed by hours, never off-hired here
  const asked = gear.filter((r) => r.hireStatus === "OFF_HIRE_REQUESTED");
  const checks = asked.length
    ? await prisma.hireCheck.findMany({ where: { resourceId: { in: asked.map((r) => r.id) }, answer: "FINISHED" }, orderBy: { createdAt: "desc" }, select: { resourceId: true, createdAt: true, by: true } })
    : [];
  const callOff = asked.map((r) => {
    const c = checks.find((x) => x.resourceId === r.id);
    return { ...base(r), finishedAt: c?.createdAt.toISOString() ?? null, finishedBy: c?.by ?? null };
  });
  const noDate = gear.filter((r) => offHireMissing(r)).map(base);
  return viewJson({ today, alerts, callOff, noDate });
});
