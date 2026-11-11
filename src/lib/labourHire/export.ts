// The labour hire timesheet's spreadsheet (11 Nov 2026, Ilies: "exported in the same format"): the staff timesheet
// export (lib/timesheets.ts timesheetCsv - the same columns, one line per sign-in, each worker's WEEK TOTAL, the same
// formula-safe cell writer csvCell) for one company's workers (or every company), with the company in the Role column,
// its own title lines and a COMPANY TOTAL line per company. Then the accounts export's clean-up: any "$" amount in free
// text taken out, and the payroll file check (fileIsSafe: no $, BSB, TFN, ABA or rates). Hours only - never a rate.
import { noDollar } from "../accountsTimesheets";
import { fileIsSafe } from "../payroll/rules";
import { timesheetCsv, weekEnd, type CsvRow } from "../timesheets";
import { bannerText, exportFileName } from "./rules";
import type { HireCompany, HireWeek } from "./week";

const clean = (s: string | null) => (s == null ? null : noDollar(s));

// Null when the file still fails the check - the route then refuses rather than send it.
export function labourHireCsv(weekStart: string, week: HireWeek, companies: HireCompany[]): string | null {
  const chosen = week.company === "all" ? null : companies.find((c) => c.key === week.company) ?? null;
  const lines = week.people.flatMap((p) => Object.values(p.days).flat()).map((l) => ({
    ...l, name: noDollar(l.name), role: clean(l.role), site: noDollar(l.site), changedByOffice: clean(l.changedByOffice),
    flagNotes: l.flagNotes?.map(noDollar),
  }));
  const shown = chosen ? [chosen] : companies;
  // PS-051: under each company's total, every spelling grouped into it and any office mapping (and who made it), so
  // whoever sends the file can see what was put together.
  const tail: CsvRow[] = shown.flatMap((c): CsvRow[] => [
    ["", noDollar(c.name), "", "COMPANY TOTAL", "", "", "", "", c.hours, "", "", `${c.workers} worker${c.workers === 1 ? "" : "s"}`],
    ["", noDollar(c.name), "", "", "", "", "", "", "", "", "", noDollar(c.groupedFrom)],
  ]);
  const title = `Lobos Contracting - labour hire timesheet, ${chosen ? noDollar(chosen.name) : "all companies"}, week ${weekStart} to ${weekEnd(weekStart)}`;
  const status = `Hours from site sign-ins - ${bannerText(week.unfinished) ?? "every line signed out and confirmed"}`;
  const csv = timesheetCsv(weekStart, lines, null, [], { head: [title, status], tail });
  return fileIsSafe(csv) ? csv : null;
}

export const labourHireFileName = (week: HireWeek, companies: HireCompany[], weekStart: string) =>
  exportFileName(week.company === "all" ? null : companies.find((c) => c.key === week.company)?.name ?? null, weekStart);
