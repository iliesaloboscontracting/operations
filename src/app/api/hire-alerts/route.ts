import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { offHireAlert } from "@/lib/hireEstimate";
import { todaySydney } from "@/lib/today";

// GET /api/hire-alerts -> hired items coming off hire: overdue (still out past
// the expected finish), finishing today, or within 3 days (21 Oct 2026).
// Names, suppliers, projects and dates only - no money.
export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const today = todaySydney();
  const items = await prisma.resource.findMany({
    // Status not set counts as still out - a plain NOT would drop those (SQL null).
    where: { type: "HIRE", active: true, offHireDate: { not: null }, OR: [{ hireStatus: null }, { hireStatus: { not: "RETURNED" } }] },
    select: {
      id: true, name: true, category: true, agency: true, hireRef: true, hireStatus: true, offHireDate: true,
      hireProject: { select: { id: true, name: true } },
    },
  });
  const order = { OVERDUE: 0, TODAY: 1, SOON: 2 } as const;
  const alerts = items
    .map((r) => ({ r, a: offHireAlert(r, today) }))
    .filter((x): x is { r: (typeof items)[number]; a: NonNullable<ReturnType<typeof offHireAlert>> } => !!x.a)
    .map(({ r, a }) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      supplier: r.agency,
      hireRef: r.hireRef,
      status: r.hireStatus,
      project: r.hireProject?.name ?? null,
      offHireDate: r.offHireDate,
      level: a.level,
      daysLeft: a.daysLeft,
    }))
    .sort((x, y) => order[x.level] - order[y.level] || x.daysLeft - y.daysLeft);
  return NextResponse.json({ today, alerts });
});
