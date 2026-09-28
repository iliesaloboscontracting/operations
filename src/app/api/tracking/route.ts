import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { tierFor, type CostStatus } from "@/lib/labourCost";
import { costAllocation } from "@/lib/costAllocation";
import { parseLooseDate, addDays } from "@/lib/dates";
import { todaySydney } from "@/lib/today";

// The historical labour-cost backfill (from the daily allocation PDFs) covers
// every real work-date up to and including this one. Jobs on or before this
// date rely purely on those stored LabourCost rows; jobs after it are costed
// live from their assignments below - this split keeps the two from ever
// double-counting the same shift.
const LABOUR_BACKFILL_CUTOFF = "2026-09-26";

// GET /api/tracking -> every non-archived project's cost to date, broken down
// by cost code (plant / attachments / trucks / hire - the same categories the
// Projects page counts already use), plus own-crew labour (from assignments,
// for dates after the historical backfill) and invoiced costs.
//
// "To date" means every running (not stood-down) job up to and including
// today - a job scheduled for next week hasn't cost anything yet.
export const GET = withErrorHandling(async () => {
  // Individual pay rate and per-person labour cost are sensitive - this whole
  // page is Manager+ only, and even a Manager only gets project-level labour
  // totals (see the ADMIN-only labour[] detail below), not per-person lines.
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  // "Up to and including today" means Sydney's today, not the server's UTC
  // day - Job.date is stored as UTC midnight of the calendar day, so this
  // stays a plain Date comparison once built from the Sydney date string.
  const todayEnd = new Date(addDays(todaySydney(), 1) + "T00:00:00.000Z");

  const projects = await prisma.project.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    include: {
      jobs: {
        where: { notRunning: false, date: { lt: todayEnd } },
        orderBy: { date: "asc" },
        include: {
          assignments: {
            include: {
              resource: {
                select: {
                  type: true, category: true, name: true, dailyRateExGst: true,
                  payRateBasis: true, ordinaryRate: true, nightRate: true, saturdayRate: true, sundayRate: true,
                  payRateConfirmed: true, hireRate: true, hireRateUnit: true,
                },
              },
            },
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
    const liveLabour: {
      id: string; personName: string; date: string; shift: "DAY" | "NIGHT";
      hours: number | null; rateTier: string | null; rateUsed: number | null; cost: number | null;
      status: CostStatus; notes: string | null;
    }[] = [];
    const hireLabourEstimate: {
      id: string; personName: string; date: string; shift: "DAY" | "NIGHT";
      hours: number | null; rateUsed: number | null; cost: number | null; status: CostStatus;
    }[] = [];
    let uncostedCount = 0;
    let unconfirmedCount = 0;

    const jobs = p.jobs
      .map((j) => {
        const byCode = { plant: 0, attach: 0, trucks: 0, hire: 0 };
        const dateStr = j.date.toISOString().slice(0, 10);
        for (const a of j.assignments) {
          const isLive = dateStr > LABOUR_BACKFILL_CUTOFF;
          const shift = j.shift as "DAY" | "NIGHT";
          const result = costAllocation(dateStr, shift, j.startTime, j.endTime, p, a.resource);

          if (result.costType === "LABOUR") {
            if (isLive) {
              liveLabour.push({
                id: `live-${a.id}`, personName: a.resource.name, date: dateStr, shift,
                hours: result.hours, rateTier: tierFor(dateStr, shift), rateUsed: result.rateUsed, cost: result.amount,
                status: result.status!, notes: null,
              });
              if (result.status === "RATE_MISSING" || result.status === "HOURS_UNKNOWN") uncostedCount++;
              if (result.status === "RATE_UNCONFIRMED") unconfirmedCount++;
            }
            continue;
          }

          // Hired labour (a named agency worker registered as a HIRE/LABOUR
          // resource): costed live from hireRate, like own crew, and kept out
          // of the dailyRateExGst "hire" cost-code bucket below so it's never
          // double-counted against the agency's actual InvoicedCost (D3) -
          // the two are reconciled, not summed.
          if (result.costType === "HIRE_LABOUR") {
            if (isLive) {
              hireLabourEstimate.push({
                id: `hire-${a.id}`, personName: a.resource.name, date: dateStr, shift,
                hours: result.hours, rateUsed: result.rateUsed, cost: result.amount, status: result.status!,
              });
              if (result.status === "RATE_MISSING" || result.status === "HOURS_UNKNOWN") uncostedCount++;
              if (result.status === "RATE_UNCONFIRMED") unconfirmedCount++;
            }
            continue;
          }

          if (result.amount == null) continue;
          const bucket = bucketOf(a.resource.type);
          if (bucket) byCode[bucket] += result.amount;
        }
        const cost = byCode.plant + byCode.attach + byCode.trucks + byCode.hire;
        return {
          id: j.id,
          date: dateStr,
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
    const labour = [
      ...p.labourCosts.map((l) => ({
        id: l.id,
        personName: l.personName,
        date: l.date,
        shift: l.shift as "DAY" | "NIGHT",
        hours: l.hours,
        rateTier: l.rateTier,
        rateUsed: l.rateUsed,
        cost: l.cost,
        status: null as CostStatus | null, // predates the status concept - not retrofitted onto history
        notes: l.notes,
      })),
      ...liveLabour,
    ].sort((a, b) => a.date.localeCompare(b.date));
    const labourTotal = labour.reduce((n, l) => n + (l.cost ?? 0), 0);
    const hireLabourEstimateTotal = hireLabourEstimate.reduce((n, l) => n + (l.cost ?? 0), 0);
    const totalCost = byCode.plant + byCode.attach + byCode.trucks + byCode.hire + invoicedTotal + labourTotal;

    return {
      id: p.id,
      name: p.name,
      client: p.client,
      jobNo: p.jobNo,
      status: p.status,
      contractValue: p.contractValue,
      contractValueNotes: p.contractValueNotes,
      totalCost,
      byCode,
      invoicedTotal,
      invoiced,
      labourTotal,
      labour: isAdmin ? labour : [],
      // D3: an estimate from allocations, never summed into totalCost -
      // shown alongside invoicedTotal so a gap between what the board says
      // and what the agency billed is visible for review, not silently
      // resolved either way.
      hireLabourEstimateTotal,
      hireLabourEstimate: isAdmin ? hireLabourEstimate : [],
      uncostedCount,
      unconfirmedCount,
      jobs,
    };
  });

  out.sort((a, b) => b.totalCost - a.totalCost);

  // Idle hire: on-hire days (since hireStart) that never landed on a job at
  // all - not attributed to any project, since idle time doesn't belong to a
  // site. hireStart/hireEnd are free text (e.g. "22 Sept"), so parsing is
  // best-effort; an unparseable hireStart just means that item can't be
  // scored and is skipped, not guessed at.
  const hireResources = await prisma.resource.findMany({
    where: { type: "HIRE", active: true, hireStart: { not: null } },
    select: {
      id: true, name: true, agency: true, hireStart: true, hireEnd: true, dailyRateExGst: true,
      assignments: { select: { job: { select: { date: true } } } },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const referenceYear = today.getFullYear();

  const idleHireItems = hireResources
    .map((r) => {
      const start = parseLooseDate(r.hireStart, referenceYear);
      if (!start) return null;
      const end = parseLooseDate(r.hireEnd, referenceYear);
      const overdue = end != null && end < today;
      const onHireDays = Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
      const workedDays = new Set(r.assignments.map((a) => a.job.date.toISOString().slice(0, 10))).size;
      const idleDays = Math.max(0, onHireDays - workedDays);
      const idleCost = r.dailyRateExGst != null ? Math.round(idleDays * r.dailyRateExGst * 100) / 100 : null;
      return {
        id: r.id, name: r.name, agency: r.agency, hireStart: r.hireStart, hireEnd: r.hireEnd,
        overdue, onHireDays, workedDays, idleDays, dailyRateExGst: r.dailyRateExGst, idleCost,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null && (r.idleDays > 0 || r.overdue))
    .sort((a, b) => (b.idleCost ?? -1) - (a.idleCost ?? -1) || b.idleDays - a.idleDays);

  const idleHire = {
    totalIdleCost: idleHireItems.reduce((n, r) => n + (r.idleCost ?? 0), 0),
    items: idleHireItems,
  };

  return NextResponse.json({ projects: out, idleHire });
});
