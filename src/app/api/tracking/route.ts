import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// GET /api/tracking -> every non-archived project's cost to date, broken down
// by cost code (plant / attachments / trucks / hire - the same categories the
// Projects page counts already use). Crew never carries a daily rate, so they
// never contribute here - this is plant/vehicle/hire cost only.
//
// "To date" means every running (not stood-down) job up to and including
// today - a job scheduled for next week hasn't cost anything yet.
export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;

  const todayEnd = new Date();
  todayEnd.setUTCHours(0, 0, 0, 0);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const projects = await prisma.project.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    include: {
      jobs: {
        where: { notRunning: false, date: { lt: todayEnd } },
        orderBy: { date: "asc" },
        include: {
          assignments: {
            include: { resource: { select: { type: true, dailyRateExGst: true } } },
          },
        },
      },
      invoicedCosts: { orderBy: { weekEnding: "asc" } },
      labourCosts: { orderBy: { date: "asc" } },
    },
  });

  const bucketOf = (type: string): "plant" | "attach" | "trucks" | "hire" | null => {
    if (type === "EQUIPMENT") return "plant";
    if (type === "ATTACHMENT") return "attach";
    if (type === "VEHICLE") return "trucks";
    if (type === "HIRE") return "hire";
    return null; // PERSONNEL - never carries a daily rate
  };

  const out = projects.map((p) => {
    const jobs = p.jobs
      .map((j) => {
        const byCode = { plant: 0, attach: 0, trucks: 0, hire: 0 };
        for (const a of j.assignments) {
          const rate = a.resource.dailyRateExGst;
          if (!rate) continue;
          const bucket = bucketOf(a.resource.type);
          if (bucket) byCode[bucket] += rate;
        }
        const cost = byCode.plant + byCode.attach + byCode.trucks + byCode.hire;
        return {
          id: j.id,
          date: j.date.toISOString().slice(0, 10),
          shift: j.shift as "DAY" | "NIGHT",
          title: j.title,
          cost,
          byCode,
        };
      })
      .filter((j) => j.cost > 0);

    const byCode = jobs.reduce(
      (acc, j) => {
        acc.plant += j.byCode.plant;
        acc.attach += j.byCode.attach;
        acc.trucks += j.byCode.trucks;
        acc.hire += j.byCode.hire;
        return acc;
      },
      { plant: 0, attach: 0, trucks: 0, hire: 0 }
    );
    const invoiced = p.invoicedCosts.map((i) => ({
      id: i.id,
      vendor: i.vendor,
      category: i.category,
      invoiceNo: i.invoiceNo,
      weekEnding: i.weekEnding,
      shift: i.shift as "DAY" | "NIGHT" | null,
      amountExGst: i.amountExGst,
    }));
    const invoicedTotal = invoiced.reduce((n, i) => n + i.amountExGst, 0);
    const labour = p.labourCosts.map((l) => ({
      id: l.id,
      personName: l.personName,
      date: l.date,
      shift: l.shift as "DAY" | "NIGHT",
      hours: l.hours,
      rateTier: l.rateTier,
      rateUsed: l.rateUsed,
      cost: l.cost,
      notes: l.notes,
    }));
    const labourTotal = labour.reduce((n, l) => n + (l.cost ?? 0), 0);
    const totalCost = byCode.plant + byCode.attach + byCode.trucks + byCode.hire + invoicedTotal + labourTotal;

    return {
      id: p.id,
      name: p.name,
      client: p.client,
      jobNo: p.jobNo,
      status: p.status,
      totalCost,
      byCode,
      invoicedTotal,
      invoiced,
      labourTotal,
      labour,
      jobs,
    };
  });

  out.sort((a, b) => b.totalCost - a.totalCost);
  return NextResponse.json(out);
});
