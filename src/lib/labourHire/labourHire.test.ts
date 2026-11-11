import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasMap, bannerText, companyKey, companyName, exportFileName, lineFlags, NO_COMPANY_KEY, resolveCompany, workerKey,
} from "./rules";
import { hireWeek, type HireLine } from "./week";
import { labourHireCsv } from "./export";
import { dayHours, personKeyFor } from "../dayHours";
import { timesheetCsv } from "../timesheets";

// The labour hire timesheet (Ilies, 11 Nov 2026).

test("company names: case, spaces, punctuation and filler words are ignored", () => {
  for (const s of ["Advanced Labour Hire", "Advanced Labour Hire P/L", "Advanced Labour Hire P.T.Y. L.T.D.", "advanced labour hire pty ltd", "ADVANCED  labour-hire", "advanced labour hiee", " advanced. "])
    assert.equal(companyKey(s), "advanced", s);
  // PS-051: Group / Services / Australia are part of the name - two companies can differ only by them.
  assert.equal(companyKey("Advanced Group"), "advanced group");
  assert.equal(companyKey("ABC Australia Pty Ltd"), "abc australia");
  assert.equal(companyKey("Smith & Sons Pty Ltd"), "smith sons");
  assert.equal(companyKey("ALH"), "alh");
  assert.equal(companyKey("A.L.H."), "alh", "letters typed one at a time are one word");
  assert.equal(companyKey("Clément Crouzet"), "clement crouzet", "accents don't split a word");
  assert.equal(companyKey("Labour Hire"), "labour hire", "a name that is only filler words keeps them");
  assert.equal(companyKey(""), NO_COMPANY_KEY);
  assert.equal(companyKey(null), NO_COMPANY_KEY);
});

test("the built-in list and the office's mappings", () => {
  const none = new Map<string, string>();
  // PS-051: every Advanced spelling seen on the sign-ins so far still comes together (the built-in list)...
  for (const s of ["Advanced", "Advance", "Adcanced", "Advanced Group", "Advanced group", "advanced group", "Advance group", "Advanced labour", "Advanced labour hiee", "Advanced Labour Hire Group"])
    assert.equal(resolveCompany(s, none), "advanced", s);
  assert.equal(resolveCompany("advanced group Anthony", none), "advanced group anthony", "...a name with more in it is left for the office");
  // ...while two other companies that differ only by Group / Services stay apart, unless the office maps them.
  assert.notEqual(resolveCompany("ABC Group", none), resolveCompany("ABC Services", none));
  assert.notEqual(resolveCompany("ABC Group", none), resolveCompany("ABC", none));
  assert.equal(resolveCompany("ABC Services", aliasMap([{ alias: "abc services", company: "ABC Group" }])), resolveCompany("ABC Group", none), "mapped by the office, they come together");
  assert.equal(resolveCompany("Advance group", none), "advanced", "built-in misspelling");
  assert.equal(resolveCompany("Adcanced", none), "advanced");
  assert.equal(resolveCompany("ALH", none), "alh", "ALH is its own until the office maps it");
  const office = aliasMap([{ alias: "alh", company: "Advanced Labour Hire" }, { alias: "old", company: "Gone Co", retiredAt: new Date() }]);
  assert.equal(resolveCompany("ALH", office), "advanced");
  assert.equal(resolveCompany("a.l.h", office), "advanced", "the typed name is tidied before it is looked up");
  assert.equal(resolveCompany("Old", office), "old", "a retired mapping no longer applies");
  // A loop stops instead of spinning.
  const loop = aliasMap([{ alias: "aaa", company: "Bbb" }, { alias: "bbb", company: "Aaa" }]);
  assert.ok(["aaa", "bbb"].includes(resolveCompany("aaa", loop)));
});

test("the name shown for a company", () => {
  const typed = new Map([["Advanced", 3], ["Advanced group", 9]]);
  assert.equal(companyName("advanced", [], typed), "Advanced Labour Hire", "built-in name");
  assert.equal(companyName("advanced", [{ alias: "alh", company: "Advanced Labour Hire Pty Ltd" }], typed), "Advanced Labour Hire Pty Ltd", "the office's mapping wins");
  assert.equal(companyName("labogo", [], new Map([["Labogo", 4], ["labogo", 1]])), "Labogo", "else the spelling typed most");
  assert.equal(companyName(NO_COMPANY_KEY, [], new Map()), "No company given");
});

test("worker names: same person typed differently", () => {
  assert.equal(workerKey("Sam  O'Brien"), workerKey("sam obrien"));
  assert.equal(workerKey("SAM-OBRIEN"), workerKey("sam obrien"));
  assert.notEqual(workerKey("Sam Brien"), workerKey("Sam O Brien"));
});

test("hours use the staff rule (lib/dayHours.ts): one break over 5h, never below 5h", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h - 11, m)); // AEDT
  const line = (id: string, personKey: string, s: Date, e: Date) => ({ id, personKey, date: "2026-11-09", start: s, end: e, breakMinutes: 30 });
  const hire = dayHours([line("h", personKeyFor(null, "Sam Smith", "Advanced"), at(7), at(15, 30))]).get("h")!;
  const staff = dayHours([line("s", "res1", at(7), at(15, 30))]).get("s")!;
  assert.deepEqual(hire, staff);
  assert.equal(hire.hours, 8);
  assert.equal(dayHours([line("x", personKeyFor(null, "A", "B"), at(7), at(12, 10))]).get("x")!.hours, 5, "5:10 counts 5.0");
});

test("the flags on a line", () => {
  assert.deepEqual(lineFlags({ out: null, onSite: false, status: "CONFIRMED" }), ["NO_SIGN_OUT"]);
  assert.deepEqual(lineFlags({ out: null, onSite: true, status: "CONFIRMED" }), ["ON_SITE"]);
  assert.deepEqual(lineFlags({ out: "3:30 pm", status: "TO_CONFIRM" }, ["LATE_IN", "NOT_A_FLAG"]), ["TO_CONFIRM", "LATE_IN"]);
  assert.deepEqual(lineFlags({ out: "3:30 pm", status: "CONFIRMED", overlap: true }, ["LONG_SHIFT", "BULK_OUT"]), ["LONG_SHIFT", "BULK_OUT", "OVERLAP"]);
  assert.equal(bannerText(3), "3 lines not finished – check before sending");
  assert.equal(bannerText(1), "1 line not finished – check before sending");
  assert.equal(bannerText(0), null);
});

const WEEK = "2026-11-09";
const mk = (id: string, date: string, workerName: string, company: string | null, o: Partial<HireLine> = {}): HireLine => {
  const base = { attendanceId: id, date, workerName, company, site: "Site A", point: false, onSite: false, in: "7:00 am", out: "3:30 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null, ...o };
  return { ...base, flags: o.flags ?? lineFlags(base) };
};
const lines = () => [
  mk("1", "2026-11-09", "Sam Smith", "Advanced Labour Hire"),
  mk("2", "2026-11-10", "sam  smith", "advanced labour hire pty ltd", { site: "Site B" }),
  mk("3", "2026-11-11", "Joe Bloggs", "ALH", { hours: 7.5 }),
  mk("4", "2026-11-11", "Ann Other", "Labogo"),
  mk("5", "2026-11-10", "Kim Lee", "Advanced", { status: "TO_CONFIRM", flags: ["TO_CONFIRM"] }),
  mk("6", "2026-11-11", "Kim Lee", "Advanced", { out: null, hours: null, flags: ["NO_SIGN_OUT"] }),
];

test("grouping, the company filter and the totals", () => {
  const before = hireWeek(WEEK, lines(), [], "all");
  assert.deepEqual(before.companies.map((c) => c.name).sort(), ["ALH", "Advanced Labour Hire", "Labogo"].sort(), "ALH stays apart until mapped");
  const aliases = [{ alias: "alh", company: "Advanced Labour Hire" }];
  const all = hireWeek(WEEK, lines(), aliases, "all");
  assert.equal(all.companies.length, 2);
  const adv = all.companies.find((c) => c.key === "advanced")!;
  assert.equal(adv.workers, 3, "Sam (typed two ways), Joe (ALH), Kim");
  assert.equal(adv.hours, 8 + 8 + 7.5 + 8);
  assert.equal(adv.unfinished, 2);
  assert.ok(adv.typed.some((t) => t.text === "ALH") && adv.typed.some((t) => t.text === "Advanced"));
  const one = hireWeek(WEEK, lines(), aliases, "advanced");
  assert.equal(one.company, "advanced");
  assert.equal(one.people.length, 3);
  assert.ok(one.people.every((p) => p.role === "Advanced Labour Hire"));
  const sam = one.people.find((p) => p.name.toLowerCase().includes("sam"))!;
  assert.equal(sam.total, 16, "one row for Sam across both spellings");
  assert.equal(one.totalHours, 31.5);
  assert.equal(one.unfinished, 2);
  assert.ok(!one.people.some((p) => p.name === "Ann Other"), "only that company's workers");
  assert.equal(hireWeek(WEEK, lines(), aliases, "nobody").company, "all", "an unknown company shows all");
});

test("the export: the staff timesheet's columns, that company only, no $ and formulas made safe", () => {
  const raw = [...lines(), mk("7", "2026-11-12", "=HYPERLINK(\"http://x\")", "Advanced", { changedByOffice: "sign-out 3pm -> 4pm (paid $50 extra)" })];
  const aliases = [{ alias: "alh", company: "Advanced Labour Hire" }];
  const w = hireWeek(WEEK, raw, aliases, "advanced");
  const csv = labourHireCsv(WEEK, w, w.companies)!;
  assert.ok(csv, "the file passes the no-money check");
  const staffHeader = timesheetCsv(WEEK, [], null).split("\r\n")[3];
  assert.equal(csv.split("\r\n")[3], staffHeader, "the same header row as the staff timesheet");
  assert.equal(staffHeader, "Employee,Role,Date,Day,Site / place,Sign in,Sign out,Unpaid break (min),Hours,Travel (h),Status,Notes");
  assert.match(csv.split("\r\n")[0], /labour hire timesheet, Advanced Labour Hire, week 2026-11-09 to 2026-11-15/);
  assert.ok(!csv.includes("$"), "no dollar sign anywhere");
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`), "a name like a formula is quoted and made text");
  assert.ok(!/(^|,)=/m.test(csv));
  assert.ok(!csv.includes("Ann Other") && !csv.includes("Labogo"), "only that company");
  assert.ok(csv.includes("COMPANY TOTAL") && csv.includes("WEEK TOTAL"));
  assert.ok(csv.includes("No sign-out") && csv.includes("Waiting for supervisor"));
  assert.equal(exportFileName("Advanced Labour Hire", WEEK), "Advanced-Labour-Hire_week-2026-11-09.csv");
  assert.equal(exportFileName(null, WEEK), "All-companies_week-2026-11-09.csv");
});

// PS-051: what was grouped together is in the file, under the company's total.
test("the export lists every spelling grouped into a company, and the office mapping with who made it", () => {
  const raw = [...lines(), mk("8", "2026-11-12", "Lee Wong", "=ALH$5", {})];
  const aliases = [
    { alias: "alh", aliasText: "ALH", company: "Advanced Labour Hire", createdBy: "Pat Office" },
    { alias: "alh 5", aliasText: "=ALH$5", company: "Advanced Labour Hire", createdBy: "Pat Office" },
  ];
  const w = hireWeek(WEEK, raw, aliases, "advanced");
  const adv = w.companies.find((c) => c.key === "advanced")!;
  assert.deepEqual(adv.mappings.map((m) => m.typed).sort(), ["=ALH$5", "ALH"]);
  const csv = labourHireCsv(WEEK, w, w.companies)!;
  assert.ok(csv, "passes fileIsSafe");
  const rows = csv.split("\r\n");
  const total = rows.findIndex((r) => r.includes("COMPANY TOTAL"));
  const grouped = rows[total + 1];
  assert.ok(total > 0 && /Grouped from: /.test(grouped), "the line straight under COMPANY TOTAL");
  for (const s of ["Advanced Labour Hire (1)", "advanced labour hire pty ltd (1)", "Advanced (2)", "ALH (1)"]) assert.ok(grouped.includes(s), s);
  assert.ok(grouped.includes(`"ALH" -> Advanced Labour Hire (by Pat Office)`) || grouped.includes(`""ALH"" -> Advanced Labour Hire (by Pat Office)`), "the office mapping and who made it");
  assert.ok(!csv.includes("$"), "an amount in a typed name is taken out");
  assert.ok(!/(^|,)=/m.test(csv), "and nothing can start a formula");
  // All companies: one total and one "Grouped from" per company.
  const all = hireWeek(WEEK, raw, aliases, "all");
  const allCsv = labourHireCsv(WEEK, all, all.companies)!;
  assert.equal(allCsv.split("\r\n").filter((r) => r.includes("Grouped from: ")).length, all.companies.length);
});

test("the staff export is unchanged when no options are given", () => {
  const l = { attendanceId: "a", date: WEEK, resourceId: "r", name: "Pat", role: "Labourer", site: "S", in: "7:00 am", out: "3:30 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null };
  const csv = timesheetCsv(WEEK, [l], null);
  assert.equal(csv.split("\r\n")[0], '"Lobos Contracting - staff timesheet, week 2026-11-09 to 2026-11-15"');
  assert.equal(csv.split("\r\n")[1], "DRAFT - not approved yet");
  assert.equal(csv.split("\r\n").filter(Boolean).length, 5, "title, status, header, the line, the week total");
});
