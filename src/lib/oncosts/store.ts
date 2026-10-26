// On-costs (Accounts stage 3, docs/accounts/STAGE3-DESIGN.md): rates entered by an Admin, and the labour cost
// view per job / week / person. The base is Tracking's own crew labour, read from loadTracking() - the same
// figures Tracking shows (frozen ledger for closed days, live costAllocation for open days, the historical
// backfill) - never recomputed. Accounts screen only; Tracking's numbers don't change.
import { prisma } from "@/lib/prisma";
import { loadTracking } from "@/lib/trackingData";
import { todaySydney } from "@/lib/today";
import { applyOnCosts, cleanRate, fyOf, groupCosts, lineList, rateOn, STANDARD_LINES, type LabourLine, type RateRow } from "./rules";

type Problem = { error: string; status: number };
type Who = { id: string; name: string };

const rowsNow = () => prisma.onCostRate.findMany({ orderBy: [{ line: "asc" }, { effectiveFrom: "asc" }, { setAt: "asc" }] });

export async function listRates() {
  const rows = await rowsNow();
  const today = todaySydney();
  return {
    // Each line with the rate in force today, or "not set".
    lines: lineList(rows as RateRow[]).map(({ line, label }) => {
      const r = rateOn(rows as RateRow[], line, today);
      const std = STANDARD_LINES.find((s) => s.line === line);
      return { line, label, inForce: r ? { percent: r.percent, base: r.base, appliesTo: r.appliesTo, thresholdRule: r.thresholdRule ?? null, thresholdAnnual: r.thresholdAnnual ?? null, effectiveFrom: r.effectiveFrom } : null, defaults: std ?? null };
    }),
    history: rows.map((r) => ({ ...r, setAt: r.setAt.toISOString(), retiredAt: r.retiredAt?.toISOString() ?? null })),
  };
}

export async function addRate(who: Who, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const c = cleanRate(b);
  if ("error" in c) return { error: c.error, status: 400 };
  const row = await prisma.onCostRate.create({ data: { ...c, thresholdRule: c.thresholdRule ?? null, thresholdAnnual: c.thresholdAnnual ?? null, setBy: who.name, setById: who.id } });
  return { id: row.id };
}

export async function retireRate(who: Who, id: string, reason: unknown): Promise<{ ok: true } | Problem> {
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  if (why.length < 3) return { error: "Say why it's being retired.", status: 400 };
  const r = await prisma.onCostRate.findUnique({ where: { id } });
  if (!r) return { error: "Not found.", status: 404 };
  if (r.retiredAt) return { error: "Already retired.", status: 409 };
  await prisma.onCostRate.update({ where: { id }, data: { retiredAt: new Date(), retiredBy: who.name, retiredReason: why } });
  return { ok: true };
}

// Tracking's own-crew labour lines, each with its person and their engagement (EMPLOYEE / ABN / not set).
export async function labourLines(): Promise<LabourLine[]> {
  const { projects } = await loadTracking({ withPeople: true });
  const raw = projects.flatMap((p) => p.labour.map((l) => ({ ...l, projectId: p.id, projectName: p.name })));
  // Live lines are "live-<assignmentId>"; the historical backfill keeps its LabourCost id.
  const assignmentIds = raw.filter((l) => l.id.startsWith("live-")).map((l) => l.id.slice(5));
  const backfillIds = raw.filter((l) => !l.id.startsWith("live-")).map((l) => l.id);
  const [assignments, backfill] = await Promise.all([
    prisma.assignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, resourceId: true } }),
    prisma.labourCost.findMany({ where: { id: { in: backfillIds } }, select: { id: true, resourceId: true } }),
  ]);
  const resOf = new Map<string, string | null>([...assignments.map((a) => [`live-${a.id}`, a.resourceId] as const), ...backfill.map((b) => [b.id, b.resourceId] as const)]);
  const people = await prisma.resource.findMany({ where: { id: { in: [...new Set([...resOf.values()].filter((x): x is string => !!x))] } }, select: { id: true, engagement: true } });
  const engagement = new Map(people.map((p) => [p.id, p.engagement]));
  return raw.map((l) => {
    const rid = resOf.get(l.id) ?? null;
    return { projectId: l.projectId, projectName: l.projectName, date: l.date, personKey: rid ?? `name:${l.personName.toLowerCase()}`, personName: l.personName, engagement: rid ? engagement.get(rid) ?? null : null, paid: l.cost };
  });
}

const dateOk = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The view: per job and per week for a date range (default: this financial year to today), plus each job's
// people. Payroll tax above a threshold needs the year's running total, so the year is costed from 1 July
// and then cut to the range.
export async function labourCostView(fromQ: string | null, toQ: string | null, projectId: string | null) {
  const today = todaySydney();
  const to = dateOk(toQ) ? toQ! : today;
  const from = dateOk(fromQ) ? fromQ! : `${fyOf(to)}-07-01`;
  const fyStart = `${fyOf(from)}-07-01`;
  const [all, rates] = await Promise.all([labourLines(), rowsNow()]);
  const costed = applyOnCosts(all.filter((l) => l.date >= fyStart && l.date <= to), rates as RateRow[]).filter((c) => c.date >= from && c.date <= to);
  const noEngagement = new Map<string, string>();
  for (const c of costed) if (c.engagement == null && c.paid != null) noEngagement.set(c.personKey, c.personName);
  const total = groupCosts(costed.map((c) => ({ ...c, projectId: "all", projectName: "All jobs" })), "project")[0] ?? null;
  return {
    from, to,
    lines: lineList(rates as RateRow[]),
    notSet: lineList(rates as RateRow[]).filter(({ line }) => !rateOn(rates as RateRow[], line, to)).map((l) => l.label),
    total,
    byJob: groupCosts(costed, "project").sort((a, b) => b.companyCost - a.companyCost),
    byWeek: groupCosts(costed, "week").sort((a, b) => a.key.localeCompare(b.key)),
    people: projectId ? groupCosts(costed.filter((c) => c.projectId === projectId), "person").sort((a, b) => b.paid - a.paid) : [],
    noEngagement: [...noEngagement.values()].sort(),
  };
}
