// Labour hire timesheet (11 Nov 2026): a week of hire sign-ins grouped by company and worker, in the same shape as the
// staff timesheet (lib/timesheets.ts peopleOf), so the page reuses the staff grids and the export the staff CSV. Pure -
// the database side is ./store.ts. Hours come in already worked out (lib/dayHours.ts, the staff rule); this only groups.
import { peopleOf, type TimesheetLine, type TimesheetPerson } from "../timesheets";
import {
  aliasMap, companyName, groupedFromText, isFlaggedInfo, isUnfinished, mostCommon, resolvePath, tidyText, workerKey,
  type CompanyAlias, type HireFlag,
} from "./rules";

// One hire sign-in as loaded: the staff line's fields, plus what was typed and its flags.
export type HireLine = Omit<TimesheetLine, "resourceId" | "role" | "name"> & { workerName: string; company: string | null; flags: HireFlag[] };

export type HireCompany = {
  key: string;
  name: string;
  typed: { text: string; lines: number }[]; // every spelling typed at sign-in, most used first
  mappings: { typed: string; company: string; by: string }[]; // the office mappings that grouped them (PS-051)
  groupedFrom: string; // "Grouped from: ..." - on the page and under the export's COMPANY TOTAL (PS-051)
  workers: number;
  lines: number;
  hours: number;
  unfinished: number; // lines with no sign-out yet or waiting for the supervisor
  flagged: number; // late / long day (information only)
  looksLikeLobos: boolean; // typed "Lobos" - probably staff signed in as hire (fix on the Sign-ins page)
};

export type HireWeek = {
  company: string; // the key shown, or "all"
  companies: HireCompany[];
  people: TimesheetPerson[]; // resourceId = the worker's group key, role = the company's name
  totalHours: number;
  lines: number;
  unfinished: number;
  flagged: number;
};

const q4 = (n: number) => Math.round(n * 4) / 4;
const bump = (m: Map<string, Map<string, number>>, k: string, text: string) => {
  const inner = m.get(k) ?? new Map<string, number>();
  inner.set(text, (inner.get(text) ?? 0) + 1);
  m.set(k, inner);
};

export function hireWeek(weekStart: string, raw: HireLine[], aliasRows: CompanyAlias[], selected: string | null | undefined): HireWeek {
  const amap = aliasMap(aliasRows);
  const keyed = raw.map((l) => {
    const path = resolvePath(l.company, amap);
    const ck = path[path.length - 1];
    return { l, ck, path, wk: `${ck}|${workerKey(l.workerName)}` };
  });
  const typedCo = new Map<string, Map<string, number>>();
  const typedWorker = new Map<string, Map<string, number>>();
  for (const { l, ck, wk } of keyed) {
    bump(typedCo, ck, tidyText(l.company) || "(blank)");
    bump(typedWorker, wk, tidyText(l.workerName));
  }
  const names = new Map([...typedCo.keys()].map((k) => [k, companyName(k, aliasRows, typedCo.get(k)!)]));
  const workerName = (wk: string) => mostCommon(typedWorker.get(wk) ?? new Map()) ?? "";

  const toLine = ({ l, ck, wk }: (typeof keyed)[number]): TimesheetLine => ({
    attendanceId: l.attendanceId, date: l.date, resourceId: wk, name: workerName(wk), role: names.get(ck) ?? null, site: l.site,
    point: l.point, onSite: l.onSite, in: l.in, out: l.out, breakMinutes: l.breakMinutes, hours: l.hours, status: l.status,
    allocated: true, // hire workers fill a labour hire tile, not the staff allocation (Sign-ins shows "no hire tile")
    overlap: l.overlap, changedByOffice: l.changedByOffice, flagNotes: l.flagNotes?.length ? l.flagNotes : undefined,
  });

  const companies: HireCompany[] = [...typedCo.keys()].map((key) => {
    const mine = keyed.filter((x) => x.ck === key);
    const typed = [...typedCo.get(key)!].map(([text, lines]) => ({ text, lines })).sort((a, b) => b.lines - a.lines || a.text.localeCompare(b.text));
    // The office mappings these lines went through on the way to this company.
    const used = new Set(mine.flatMap((x) => x.path.slice(0, -1)));
    const mappings = aliasRows
      .filter((r) => !r.retiredAt && used.has(r.alias))
      .map((r) => ({ typed: tidyText(r.aliasText ?? r.alias), company: tidyText(r.company), by: tidyText(r.createdBy ?? "the office") }));
    return {
      key,
      name: names.get(key)!,
      typed,
      mappings,
      groupedFrom: groupedFromText(typed, mappings),
      workers: new Set(mine.map((x) => x.wk)).size,
      lines: mine.length,
      hours: q4(mine.reduce((n, x) => n + (x.l.hours ?? 0), 0)),
      unfinished: mine.filter((x) => isUnfinished(x.l.flags)).length,
      flagged: mine.filter((x) => isFlaggedInfo(x.l.flags)).length,
      looksLikeLobos: key.split(" ").includes("lobos"),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const company = selected && selected !== "all" && companies.some((c) => c.key === selected) ? selected : "all";
  const chosen = company === "all" ? keyed : keyed.filter((x) => x.ck === company);
  return {
    company,
    companies,
    people: peopleOf(weekStart, chosen.map(toLine)),
    totalHours: q4(chosen.reduce((n, x) => n + (x.l.hours ?? 0), 0)),
    lines: chosen.length,
    unfinished: chosen.filter((x) => isUnfinished(x.l.flags)).length,
    flagged: chosen.filter((x) => isFlaggedInfo(x.l.flags)).length,
  };
}
