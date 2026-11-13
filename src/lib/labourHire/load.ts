// The labour hire timesheet's week, as the page and the export read it (11 Nov 2026). View only - no approval or lock.
import { todaySydney } from "../today";
import { weekDates, weekEnd, weekHasEnded } from "../timesheets";
import { companyAliases, companyRows, hireLines, toCompanyAlias } from "./store";
import { bannerText, signInList } from "./rules";
import { hireWeek } from "./week";

export async function labourHireWeek(weekStart: string, company: string | null) {
  const [raw, aliases, listRows] = await Promise.all([hireLines(weekStart), companyAliases(), companyRows()]);
  const week = hireWeek(weekStart, raw, aliases.map(toCompanyAlias), company, signInList(listRows));
  return {
    weekStart,
    weekEnd: weekEnd(weekStart),
    days: weekDates(weekStart),
    today: todaySydney(),
    weekEnded: weekHasEnded(weekStart),
    ...week,
    banner: bannerText(week.unfinished),
    aliases: aliases.map((a) => ({
      id: a.id, aliasText: a.aliasText, alias: a.alias, company: a.company, createdBy: a.createdBy, createdAt: a.createdAt.toISOString(),
      retiredAt: a.retiredAt?.toISOString() ?? null, retiredBy: a.retiredBy, retireReason: a.retireReason,
    })),
    // The sign-in list (13 Nov 2026): the built-in companies, then every company the office added (on or off).
    signInList: [
      ...signInList([]).map((c) => ({ id: null, name: c.name, builtIn: true, createdBy: null, createdAt: null, retiredAt: null, retiredBy: null, retireReason: null })),
      ...listRows.map((r) => ({
        id: r.id, name: r.name, builtIn: false, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
        retiredAt: r.retiredAt?.toISOString() ?? null, retiredBy: r.retiredBy, retireReason: r.retireReason,
      })),
    ],
  };
}
