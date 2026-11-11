// Labour hire timesheet (11 Nov 2026) - the database side: the week's hire sign-ins with their hours and flags, and the
// office's company-name mappings. Read-only on sign-ins; the only writes are the mappings (kept forever, with history).
import { prisma } from "../prisma";
import { jobLabel, STILL_ON_HOURS, sydneyTime } from "../signin";
import { dayHoursFor } from "../dayHoursStore";
import { effectiveTimes } from "../shiftTimes";
import { flagsForJobRows, signedInEarlierIds } from "../signinFlags";
import { officeChangesText, weekEnd } from "../timesheets";
import { recordChanges, writeChanges, writeLock, type Who } from "../history/store";
import { assertNoMoney } from "../moneyGuard";
import { companyKey, lineFlags, tidyText, type CompanyAlias } from "./rules";
import type { HireLine } from "./week";


// Every hire / subcontract sign-in of the week (no Labour-register person - the worker typed their name and company),
// not removed and not rejected, with the hours the Sign-ins page shows (lib/dayHoursStore.ts dayHoursFor - one break
// per person per day over 5 h, overlaps once, each day rounded once: the staff rule) and the Sign-ins page's flags.
export async function hireLines(weekStart: string): Promise<HireLine[]> {
  const rows = await prisma.siteAttendance.findMany({
    where: { date: { gte: weekStart, lte: weekEnd(weekStart) }, resourceId: null, removedAt: null, status: { not: "REJECTED" } },
    orderBy: [{ workerName: "asc" }, { signInAt: "asc" }],
    include: {
      job: {
        select: {
          id: true, title: true, shift: true, startTime: true, endTime: true,
          project: { select: { name: true, unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
        },
      },
      edits: { orderBy: { editedAt: "asc" } },
    },
  });
  if (!rows.length) return [];
  const day = await dayHoursFor(rows);

  // Late sign-in / long day / signed out together - exactly as the Sign-ins page works them out: each job's sign-ins
  // (staff too, for "signed out together"), and who had already signed in earlier that day.
  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((x): x is string => !!x))];
  const jobRows = jobIds.length
    ? await prisma.siteAttendance.findMany({ where: { jobId: { in: jobIds }, removedAt: null }, select: { id: true, jobId: true, signInAt: true, signOutAt: true, signOutMethod: true, status: true } })
    : [];
  const earlier = signedInEarlierIds(rows.map((a) => ({ id: a.id, key: `${a.date}|${a.workerName}|${a.company ?? ""}`, signInAt: a.signInAt, status: a.status })));
  const extra = new Map<string, { flags: string[]; notes: Partial<Record<string, string>> }>();
  for (const jobId of jobIds) {
    const job = rows.find((r) => r.jobId === jobId)!.job!;
    const date = rows.find((r) => r.jobId === jobId)!.date;
    const times = effectiveTimes(job, job.project);
    const flags = flagsForJobRows(
      jobRows.filter((r) => r.jobId === jobId).map((r) => ({ ...r, signedInEarlier: earlier.has(r.id) })),
      { date, shift: job.shift, start: times.start, end: times.end },
    );
    for (const [id, f] of flags) extra.set(id, f);
  }

  return rows.map((a) => {
    const h = day.get(a.id) ?? { hours: null, overlap: false, breakMinutes: 0 };
    const x = extra.get(a.id);
    const base = {
      attendanceId: a.id,
      date: a.date,
      workerName: a.workerName,
      company: a.company,
      site: a.job ? jobLabel(a.job) : a.placeLabel ?? a.place ?? "Sign-in point",
      point: !a.job,
      onSite: !a.signOutAt && Date.now() - a.signInAt.getTime() < STILL_ON_HOURS * 3_600_000,
      in: sydneyTime(a.signInAt)!,
      out: sydneyTime(a.signOutAt),
      breakMinutes: h.breakMinutes,
      hours: h.hours,
      overlap: h.overlap || undefined,
      status: a.status,
      allocated: a.allocated,
      changedByOffice: officeChangesText(a.edits),
      flagNotes: Object.values(x?.notes ?? {}).filter((n): n is string => !!n),
    };
    return { ...base, flags: lineFlags(base, x?.flags ?? []) };
  });
}

// ---------- company-name mappings ----------

export type AliasRow = {
  id: string; alias: string; aliasText: string; company: string; createdBy: string; createdAt: Date; updatedAt: Date;
  retiredAt: Date | null; retiredBy: string | null; retireReason: string | null;
};

// Every mapping, live and retired, newest change first (the order companyName() relies on).
export const companyAliases = (): Promise<AliasRow[]> =>
  prisma.labourHireCompanyAlias.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });

export const toCompanyAlias = (r: AliasRow): CompanyAlias => ({ alias: r.alias, company: r.company, retiredAt: r.retiredAt, aliasText: r.aliasText, createdBy: r.createdBy });

const MAX = 80;
export class AliasError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Map a typed company name to a company: a new mapping, a retired one brought back, or a live one pointed elsewhere.
// One row per typed name (its key). Every change - the first one too - is written to RecordChange in the same
// transaction. Names only: an amount in either is refused.
export async function mapCompany(typedIn: unknown, companyIn: unknown, by: Who) {
  const aliasText = tidyText(typeof typedIn === "string" ? typedIn : "");
  const company = tidyText(typeof companyIn === "string" ? companyIn : "");
  if (aliasText.length < 1 || aliasText.length > MAX) throw new AliasError("Enter the name as it was typed.");
  if (company.length < 2 || company.length > MAX) throw new AliasError("Enter the company it means (2 to 80 letters).");
  if (!assertNoMoney(aliasText) || !assertNoMoney(company)) throw new AliasError("Names only - no amounts.");
  const alias = companyKey(aliasText);
  const ctx = { by, source: "Labour hire timesheet - company names" };
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const existing = await tx.labourHireCompanyAlias.findUnique({ where: { alias } });
    if (!existing) {
      const row = await tx.labourHireCompanyAlias.create({
        data: { alias, aliasText, company, createdBy: (by?.name ?? "Operations").slice(0, 120), createdById: by?.id ?? null },
      });
      await writeChanges(tx, "LabourHireCompanyAlias", row.id, [
        { field: "aliasText", before: null, after: aliasText },
        { field: "company", before: null, after: company },
      ], ctx);
      return { row, changed: true };
    }
    if (existing.company === company && existing.aliasText === aliasText && !existing.retiredAt) return { row: existing, changed: false };
    const data = { aliasText, company, retiredAt: null, retiredBy: null, retireReason: null };
    const row = await tx.labourHireCompanyAlias.update({ where: { id: existing.id }, data });
    await recordChanges(tx, "LabourHireCompanyAlias", existing.id, existing, row, ctx, Object.keys(data));
    return { row, changed: true };
  });
}

// Stop using a mapping (never deleted - the row and its history stay; mapping the same name again brings it back).
export async function retireCompanyAlias(id: unknown, reasonIn: unknown, by: Who) {
  if (typeof id !== "string" || !id || id.length > 64) throw new AliasError("Unknown mapping.", 404);
  const reason = tidyText(typeof reasonIn === "string" ? reasonIn : "").slice(0, 300);
  if (reason.length < 3) throw new AliasError("Say why this mapping is no longer right.");
  const ctx = { by, source: "Labour hire timesheet - company names", reason };
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const existing = await tx.labourHireCompanyAlias.findUnique({ where: { id } });
    if (!existing) throw new AliasError("Unknown mapping.", 404);
    if (existing.retiredAt) throw new AliasError("That mapping is already retired.", 409);
    const data = { retiredAt: new Date(), retiredBy: (by?.name ?? "Operations").slice(0, 120), retireReason: reason };
    const row = await tx.labourHireCompanyAlias.update({ where: { id }, data });
    await recordChanges(tx, "LabourHireCompanyAlias", id, existing, row, ctx, Object.keys(data));
    return row;
  });
}
