// The labour hire timesheet's week, as the page and the export read it (11 Nov 2026). View only - no approval or lock.
import { todaySydney } from "../today";
import { weekDates, weekEnd, weekHasEnded } from "../timesheets";
import { companyAliases, hireLines, toCompanyAlias } from "./store";
import { bannerText } from "./rules";
import { hireWeek } from "./week";

export async function labourHireWeek(weekStart: string, company: string | null) {
  const [raw, aliases] = await Promise.all([hireLines(weekStart), companyAliases()]);
  const week = hireWeek(weekStart, raw, aliases.map(toCompanyAlias), company);
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
  };
}
