import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { tierFor, type CostStatus } from "@/lib/labourCost";
import { costAllocation } from "@/lib/costAllocation";
import { fmtDay, parseISO, parseLooseDate, addDays } from "@/lib/dates";
import { todaySydney } from "@/lib/today";
import { hireEstimate } from "@/lib/hireEstimate";

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

  // Phase 5: a closed date's cost comes from the frozen ledger, not a fresh
  // recompute - that's the point of closing it. Only assignmentId is used to
  // look a row up; hours/rateTier are still derived live from the job/
  // resource for display (they don't change after the fact, only pay rates
  // and hire rates can), so only the dollar amount and status are ledger-
  // sourced.
  const closedDateRows = await prisma.dayClose.findMany({ where: { status: "CLOSED" }, select: { date: true } });
  const closedDates = new Set(closedDateRows.map((r) => r.date));
  const frozenRows = closedDates.size
    ? await prisma.allocationCost.findMany({ where: { date: { in: [...closedDates] } } })
    : [];
  const frozenByAssignment = new Map<string, (typeof frozenRows)[number]>();
  for (const r of frozenRows) frozenByAssignment.set(r.assignmentId, r);

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
                  payRateConfirmed: true, hireRate: true, hireRateUnit: true, hireProjectId: true,
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

  // Hire register (21 Oct 2026): hired plant / equipment / tools / vehicles
  // tied to a project are costed as an ESTIMATE for every working day on
  // hire (lib/hireEstimate.ts) - the way suppliers charge - instead of per
  // board day. So their board allocations and idle days are skipped below,
  // never counted twice. Hired labour stays costed by hours as before.
  const todayIso = todaySydney();
  const registered = await prisma.resource.findMany({
    where: { type: "HIRE", hireProjectId: { not: null }, NOT: { category: "LABOUR" } },
    select: {
      id: true, name: true, category: true, agency: true, hireRef: true, hireProjectId: true, hireStatus: true,
      onHireDate: true, offHireDate: true, hireRate: true, hireRateUnit: true, dailyRateExGst: true,
      hireDeliveryCost: true, hireCollectionCost: true,
    },
  });
  const isRegisteredHire = (r: { type: string; category: string | null; hireProjectId?: string | null }) =>
    r.type === "HIRE" && r.category !== "LABOUR" && !!r.hireProjectId;

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
      status: CostStatus; notes: string | null; source: "recorded" | "estimated";
    }[] = [];
    const hireLabourEstimate: {
      id: string; personName: string; date: string; shift: "DAY" | "NIGHT";
      hours: number | null; rateUsed: number | null; cost: number | null; status: CostStatus;
      source: "recorded" | "estimated";
    }[] = [];
    let uncostedCount = 0;
    let unconfirmedCount = 0;
    // Phase 5: how much of totalCost's live-costed portion (post-backfill-
    // cutoff) is locked in from a closed day's frozen ledger vs still being
    // recomputed live because the day's open. Pre-cutoff historical rows
    // (labourCosts below) aren't part of this split - they predate the
    // whole close/re-open concept and never move either way.
    let recordedCost = 0;
    let estimatedCost = 0;

    const jobs = p.jobs
      .map((j) => {
        const byCode = { plant: 0, attach: 0, trucks: 0, hire: 0 };
        const dateStr = j.date.toISOString().slice(0, 10);
        const isLive = dateStr > LABOUR_BACKFILL_CUTOFF;
        const isClosed = isLive && closedDates.has(dateStr);
        let jobLabourCost = 0;
        for (const a of j.assignments) {
          if (isRegisteredHire(a.resource)) continue; // costed by hire period below
          const shift = j.shift as "DAY" | "NIGHT";
          const result = costAllocation(dateStr, shift, j.startTime, j.endTime, p, a.resource);
          const frozen = isClosed ? frozenByAssignment.get(a.id) : undefined;
          const cost = frozen ? frozen.amount : result.amount;
          const status = (frozen ? frozen.status : result.status) as CostStatus | null;
          const source: "recorded" | "estimated" = isClosed ? "recorded" : "estimated";

          if (result.costType === "LABOUR") {
            if (isLive) {
              liveLabour.push({
                id: `live-${a.id}`, personName: a.resource.name, date: dateStr, shift,
                hours: result.hours, rateTier: tierFor(dateStr, shift), rateUsed: result.rateUsed, cost,
                status: status!, notes: null, source,
              });
              jobLabourCost += cost ?? 0;
              if (status === "RATE_MISSING" || status === "HOURS_UNKNOWN") uncostedCount++;
              if (status === "RATE_UNCONFIRMED") unconfirmedCount++;
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
                hours: result.hours, rateUsed: result.rateUsed, cost, status: status!, source,
              });
              if (status === "RATE_MISSING" || status === "HOURS_UNKNOWN") uncostedCount++;
              if (status === "RATE_UNCONFIRMED") unconfirmedCount++;
            }
            continue;
          }

          // Plant / attachments / vehicles / hired plant-or-vehicles (Phase
          // 2b): flagged the same way labour is, instead of a silent $0 -
          // previously nothing here ever counted toward uncostedCount.
          if (status === "RATE_MISSING" || status === "HOURS_UNKNOWN") uncostedCount++;
          if (status === "RATE_UNCONFIRMED") unconfirmedCount++;
          if (cost == null) continue;
          const bucket = bucketOf(a.resource.type);
          if (bucket) byCode[bucket] += cost;
        }
        const cost = byCode.plant + byCode.attach + byCode.trucks + byCode.hire;
        if (isLive) {
          if (isClosed) recordedCost += cost + jobLabourCost;
          else estimatedCost += cost + jobLabourCost;
        }
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
      gst: i.gst,
      notes: i.notes,
      hireResourceId: i.hireResourceId,
      periodFrom: i.periodFrom,
      periodTo: i.periodTo,
    }));
    const invoicedTotal = invoiced.reduce((n, i) => n + i.amountExGst, 0);
    const labourHireInvoicedTotal = invoiced
      .filter((i) => i.category === "LABOUR_HIRE")
      .reduce((n, i) => n + i.amountExGst, 0);
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
        source: null as "recorded" | "estimated" | null, // predates the close/re-open concept
      })),
      ...liveLabour,
    ].sort((a, b) => a.date.localeCompare(b.date));
    const labourTotal = labour.reduce((n, l) => n + (l.cost ?? 0), 0);
    // Registered hire for this project - estimates, to date and to finish.
    const hireItems = registered
      .filter((r) => r.hireProjectId === p.id)
      .map((r) => {
        // Days a linked supplier invoice already bills drop out of the estimate
        // (the invoice itself is in invoicedTotal) - never counted twice.
        const billed = invoiced
          .filter((i) => i.hireResourceId === r.id && i.periodFrom && i.periodTo)
          .map((i) => ({ from: i.periodFrom as string, to: i.periodTo as string }));
        const e = hireEstimate(r, todayIso, billed);
        return {
          id: r.id, name: r.name, category: r.category, supplier: r.agency, hireRef: r.hireRef, status: r.hireStatus,
          onHireDate: r.onHireDate, offHireDate: r.offHireDate,
          dayRate: e?.dayRate ?? null, daysToDate: e?.daysToDate ?? 0, daysInvoiced: e?.daysInvoiced ?? 0,
          costToDate: e?.costToDate ?? null, costTotal: e?.costTotal ?? null,
        };
      });
    const hireEstimateToDate = hireItems.reduce((n, h) => n + (h.costToDate ?? 0), 0);
    byCode.hire += hireEstimateToDate;
    estimatedCost += hireEstimateToDate;
    uncostedCount += hireItems.filter((h) => h.costToDate == null && h.daysToDate - h.daysInvoiced > 0).length;
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
      // Phase 5: how much of totalCost is locked in (closed day, from the
      // frozen ledger) vs still live (open day, recomputed on every call).
      // Doesn't include the pre-cutoff historical backfill - see above.
      recordedCost,
      estimatedCost,
      invoicedTotal,
      labourHireInvoicedTotal,
      invoiced,
      labourTotal,
      labour: isAdmin ? labour : [],
      // D3: an estimate from allocations, never summed into totalCost -
      // shown alongside invoicedTotal so a gap between what the board says
      // and what the agency billed is visible for review, not silently
      // resolved either way.
      hireLabourEstimateTotal,
      // Hire register estimates (included in byCode.hire / totalCost above).
      hireEstimateToDate,
      hireItems,
      hireLabourEstimate: isAdmin ? hireLabourEstimate : [],
      uncostedCount,
      unconfirmedCount,
      jobs,
    };
  });

  out.sort((a, b) => b.totalCost - a.totalCost);

  // Idle hire: on-hire days (since onHireDate/hireStart) that never landed
  // on a job at all - not attributed to any project, since idle time
  // doesn't belong to a site. Prefers the typed onHireDate/offHireDate
  // (Phase 2b) over hireStart/hireEnd's legacy free text (e.g. "22 Sept"),
  // which stays best-effort parsed until re-entered; an unparseable/unset
  // start just means that item can't be scored and is skipped, not guessed at.
  const hireResources = await prisma.resource.findMany({
    // Registered hire tied to a project is already charged to that project
    // for every day on hire, so it's never "idle" here.
    where: {
      type: "HIRE", active: true, OR: [{ hireStart: { not: null } }, { onHireDate: { not: null } }],
      NOT: { AND: [{ hireProjectId: { not: null } }, { category: { not: "LABOUR" } }] },
    },
    select: {
      id: true, name: true, agency: true, hireStart: true, hireEnd: true, onHireDate: true, offHireDate: true,
      dailyRateExGst: true, hireRate: true, hireRateUnit: true,
      assignments: { select: { job: { select: { date: true } } } },
    },
  });

  // Phase 2b: an idle day is estimated from hireRate the same way a worked
  // day now is - DAY as-is, WEEK/5 (confirmed divisor) - taking priority
  // over the legacy dailyRateExGst. An HOUR rate has no day-length to apply
  // to an idle (unworked) day, so it falls back to dailyRateExGst instead
  // of guessing hours that were never allocated.
  function idleDailyRate(r: { hireRate: number | null; hireRateUnit: string | null; dailyRateExGst: number | null }): number | null {
    if (r.hireRate != null && r.hireRateUnit === "DAY") return r.hireRate;
    if (r.hireRate != null && r.hireRateUnit === "WEEK") return Math.round((r.hireRate / 5) * 100) / 100;
    return r.dailyRateExGst;
  }

  // Sydney's calendar day, so idle-hire days don't depend on the server's clock/zone.
  const today = parseISO(todaySydney());
  const referenceYear = today.getFullYear();

  const idleHireItems = hireResources
    .map((r) => {
      const start = r.onHireDate ? parseISO(r.onHireDate) : parseLooseDate(r.hireStart, referenceYear);
      if (!start) return null;
      const end = r.offHireDate ? parseISO(r.offHireDate) : parseLooseDate(r.hireEnd, referenceYear);
      const overdue = end != null && end < today;
      const onHireDays = Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000));
      const workedDays = new Set(r.assignments.map((a) => a.job.date.toISOString().slice(0, 10))).size;
      const idleDays = Math.max(0, onHireDays - workedDays);
      const rateUsed = idleDailyRate(r);
      const idleCost = rateUsed != null ? Math.round(idleDays * rateUsed * 100) / 100 : null;
      const dayLabel = { day: "numeric" as const, month: "short" as const };
      return {
        id: r.id, name: r.name, agency: r.agency,
        hireStart: r.onHireDate ? fmtDay(r.onHireDate, dayLabel) : r.hireStart,
        hireEnd: r.offHireDate ? fmtDay(r.offHireDate, dayLabel) : r.hireEnd,
        overdue, onHireDays, workedDays, idleDays, rateUsed, idleCost,
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
